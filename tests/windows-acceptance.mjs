import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createVaultThroughUI } from './onboarding.mjs'

const { _electron } = await import(pathToFileURL(process.env.JIAZI_PLAYWRIGHT_MODULE).href)
const root = process.cwd(), output = resolve(root, 'output/playwright')
const step = process.argv[2]
assert.ok(['conflict', 'enroll', 'cancel', 'lock', 'sleep', 'hotkey'].includes(step))
const data = resolve(output, process.env.JIAZI_WINDOWS_DATA || 'windows-v12-acceptance')
assert.ok(data.startsWith(output + '\\') || data.startsWith(output + '/'))
await mkdir(data, { recursive: true })
const password = 'windows-v12-test-master-password', report = [], errors = []
let application, holder, page, originalClipboard, events = []
const pass = (message) => { report.push(message); console.log('PASS ' + message) }
const call = (command, args) => page.evaluate(({ command, args }) => window.jiaziVault.invoke(command, args), { command, args })
async function launch() {
  application = await _electron.launch({ executablePath: resolve(root, 'node_modules/electron/dist/electron.exe'), args: [resolve(root, 'tests/electron-launch.cjs')], cwd: root, env: { ...process.env, JIAZI_TEST_DATA: data } })
  page = await application.firstWindow()
  page.setDefaultTimeout(15_000)
  page.on('pageerror', (error) => errors.push(error.message))
  await page.getByRole('heading', { name: /欢迎使用 Jiazi Vault|解锁保险库/ }).waitFor()
}
async function unlock() {
  if (!(await call('get_vault_status')).exists) await createVaultThroughUI(page, password)
  else {
    await page.getByPlaceholder('主密码', { exact: true }).fill(password)
    await page.getByRole('button', { name: '解锁', exact: true }).click()
    await page.getByRole('heading', { name: '全部条目', exact: true }).waitFor()
  }
}
try {
  if (step === 'conflict') {
    holder = await _electron.launch({ executablePath: resolve(root, 'node_modules/electron/dist/electron.exe'), args: [resolve(root, 'tests/shortcut-holder.cjs')], cwd: root, env: { ...process.env, JIAZI_TEST_DATA: data + '-holder' } })
    assert.equal(await holder.evaluate(() => globalThis.shortcutHeld), true, 'Shortcut already occupied before test holder started')
  }
  await launch()
  originalClipboard = await application.evaluate(async ({ clipboard }) => clipboard.readText())
  if (step === 'cancel') {
    assert.equal((await call('get_biometric_status')).enabled, true)
    console.log('ACTION: cancel Windows Hello in the next OS dialog. Do not authenticate.')
    await page.getByRole('button', { name: '使用 Windows Hello 解锁', exact: true }).click()
    await page.waitForFunction(() => document.body.textContent.includes('系统认证已取消或失败') || [...document.querySelectorAll('h1')].some((h) => h.textContent === '全部条目'), undefined, { timeout: 120_000 })
    assert.equal((await call('get_vault_status')).unlocked, false, 'OS verification succeeded instead of being canceled')
    await assert.rejects(call('list_items', {}), /VAULT_LOCKED/)
    pass('real Windows Hello cancellation keeps the vault locked and denies sensitive IPC')
    await unlock()
    await call('disable_biometric')
    pass('master password still unlocks after cancellation; isolated enrollment removed')
  } else {
    await unlock()
    if (step === 'conflict') {
      assert.equal((await call('get_desktop_status')).shortcutRegistered, false)
      await page.getByRole('link', { name: '设置', exact: true }).click()
      await page.getByText(/注册失败，可能已被其他应用占用/).waitFor()
      await page.keyboard.press('Control+k')
      await page.getByRole('dialog').getByText('快捷搜索', { exact: true }).waitFor()
      pass('separate process owns OS hotkey; app reports conflict and in-app Ctrl K still opens search')
      await application.close()
      await holder.close()
      holder = undefined
      await launch()
      assert.equal((await call('get_desktop_status')).shortcutRegistered, true)
      pass('registration succeeds after holder exits and application restarts')
    } else if (step === 'enroll') {
      await page.getByRole('link', { name: '设置', exact: true }).click()
      assert.equal((await call('get_biometric_status')).available, true)
      await page.getByPlaceholder('启用前验证主密码').fill(password)
      console.log('ACTION: approve Windows Hello once to enroll this isolated test vault.')
      await page.getByRole('button', { name: '启用系统快捷解锁', exact: true }).click()
      await page.getByRole('button', { name: '关闭系统快捷解锁', exact: true }).waitFor({ timeout: 120_000 })
      pass('real Windows Hello enrolls the isolated acceptance vault')
    } else if (step === 'hotkey') {
      assert.equal((await call('get_desktop_status')).shortcutRegistered, true)
      await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].hide())
      console.log('ACTION: physically press Ctrl + Shift + P to show the app and quick search.')
      await page.getByRole('dialog').getByText('快捷搜索', { exact: true }).waitFor({ timeout: 180_000 })
      assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), true)
      pass('physical OS hotkey shows the hidden application and opens quick search')
    } else {
      await call('update_settings', { settings: { ...(await call('get_settings')), autoLockMinutes: null, clipboardClearTimeout: 'never' } })
      let item = (await call('list_items', {})).find((item) => item.title === 'Windows lifecycle env')
      if (!item) item = await call('create_item', { item: { type: 'env', title: 'Windows lifecycle env', environment: 'testing', fields: { TOKEN: 'windows-lifecycle-secret' }, favorite: false } })
      await page.getByRole('link', { name: '设置', exact: true }).click()
      await page.getByRole('link', { name: '全部条目', exact: true }).click()
      await page.locator('.item-main').filter({ hasText: 'Windows lifecycle env' }).click()
      await page.getByRole('button', { name: '显示TOKEN', exact: true }).click()
      await call('copy_to_clipboard', { text: 'windows-lifecycle-secret', itemId: item.id })
      await application.evaluate(({ powerMonitor }, path) => {
        const fs = process.getBuiltinModule('node:fs')
        fs.writeFileSync(path, '')
        globalThis.windowsEvents = []
        for (const name of ['lock-screen', 'unlock-screen', 'suspend', 'resume']) powerMonitor.on(name, () => {
          const event = { name, at: new Date().toISOString() }
          globalThis.windowsEvents.push(event)
          fs.appendFileSync(path, JSON.stringify(event) + '\n')
        })
      }, resolve(output, `windows-${step}-v12-events.jsonl`))
      const wanted = step === 'lock' ? ['lock-screen', 'unlock-screen'] : ['suspend', 'resume']
      console.log(step === 'lock' ? 'ACTION: press Win + L, then sign back in.' : 'ACTION: use Windows Sleep/Hibernate, then wake and sign back in.')
      const deadline = Date.now() + 600_000
      while (Date.now() < deadline) {
        events = await application.evaluate(() => globalThis.windowsEvents)
        if (wanted.every((name) => events.some((event) => event.name === name))) break
        await page.waitForTimeout(500)
      }
      assert.ok(wanted.every((name) => events.some((event) => event.name === name)), 'Required real OS events not received')
      assert.equal((await call('get_vault_status')).unlocked, false)
      await page.getByRole('heading', { name: '解锁保险库', exact: true }).waitFor()
      assert.equal(await page.getByPlaceholder('变量集名称').count(), 0)
      await assert.rejects(call('get_item', { id: item.id }), /VAULT_LOCKED/)
      assert.equal(await application.evaluate(async ({ clipboard }) => clipboard.readText()), '')
      await unlock()
      assert.deepEqual((await call('get_item', { id: item.id })).fields, { TOKEN: 'windows-lifecycle-secret' })
      pass(`real OS ${step}: vault locks, editor disappears, clipboard clears, reads denied, and data survives unlock`)
    }
  }
  assert.deepEqual(errors, [])
} catch (error) { errors.push(String(error)); throw error }
finally {
  if (application && originalClipboard !== undefined) await application.evaluate(async ({ clipboard }, text) => clipboard.writeText(text), originalClipboard).catch(() => {})
  await application?.close().catch(() => {})
  await holder?.close().catch(() => {})
  await writeFile(resolve(output, `windows-${step}-v12-report.json`), JSON.stringify({ step, report, errors, data, events, boundaries: 'Real OS registration and user-operated Windows UI; no synthetic powerMonitor events. Isolated test vault.' }, null, 2))
}
