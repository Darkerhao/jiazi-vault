import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import electron from 'electron'
import { _electron } from 'playwright-core'
import { createVaultThroughUI } from './onboarding.mjs'

const output = resolve('output/playwright/workflow-reliability')
const data = join(output, `data-${Date.now()}`), password = 'workflow-fixture-password'
const scenario = process.argv[2]
await mkdir(data, { recursive: true })
const application = await _electron.launch({ executablePath: electron, args: [resolve('tests/electron-launch.cjs')], env: { ...process.env, JIAZI_TEST_DATA: data } })
const page = await application.firstWindow()
page.setDefaultTimeout(7000)
const errors = [], passed = []
page.on('pageerror', error => errors.push(error.message))
const call = (command, args) => page.evaluate(({ command, args }) => window.jiaziVault.invoke(command, args), { command, args })
const button = name => page.getByRole('button', { name, exact: true })
const section = name => page.getByRole('link', { name, exact: true }).click()
const pass = name => { passed.push(name); console.log(`PASS ${name}`) }
try {
  await createVaultThroughUI(page, password)
  if (!scenario || scenario === 'backup') {
    await application.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }) }, data)
    await call('configure_automatic_backup', { enabled: true })
    const before = (await call('get_automatic_backup_status')).lastBackupAt
    await page.keyboard.press('Control+n')
    await page.getByPlaceholder('凭证名称', { exact: true }).fill('及时备份')
    await button('保存').click()
    await page.getByRole('dialog').waitFor({ state: 'hidden' })
    for (let i = 0; i < 40 && (await call('get_backup_status')).hasChanges; i++) await new Promise(resolve => setTimeout(resolve, 50))
    assert.equal((await call('get_backup_status')).hasChanges, false)
    const after = await call('get_automatic_backup_status')
    assert.ok(after.lastBackupAt > before && after.fileExists)
    const { readBackup } = await import('../dist-electron/backup.js')
    const { readdir, readFile } = await import('node:fs/promises')
    const files = (await readdir(after.directory)).sort()
    const backup = await readBackup(await readFile(join(after.directory, files.at(-1)), 'utf8'), password)
    assert.ok(backup.items.some(item => item.title === '及时备份'))
    pass('a saved credential reaches a readable encrypted backup without waiting fifteen minutes')
  }
  if (!scenario || scenario === 'close') {
    await page.keyboard.press('Control+n')
    await page.getByPlaceholder('凭证名称', { exact: true }).fill('未保存草稿')
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
    await button('继续编辑').waitFor()
    assert.equal((await call('get_vault_status')).unlocked, true)
    await button('继续编辑').click()
    await button('放弃修改').waitFor({ state: 'hidden' })
    assert.equal(await page.getByPlaceholder('凭证名称', { exact: true }).inputValue(), '未保存草稿')
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
    await button('放弃修改').click()
    await page.getByRole('heading', { name: '解锁保险库' }).waitFor()
    assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), false)
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].show())
    await page.getByPlaceholder('主密码', { exact: true }).fill(password)
    await button('解锁').click()
    await page.getByRole('heading', { name: '全部条目' }).waitFor()
    await section('项目')
    await button('新建项目').click()
    await page.getByPlaceholder('项目名称', { exact: true }).fill('未保存项目')
    await application.evaluate(({ app }) => app.quit())
    await button('继续编辑').click()
    await button('放弃修改').waitFor({ state: 'hidden' })
    assert.equal(await page.getByPlaceholder('项目名称', { exact: true }).inputValue(), '未保存项目')
    await application.evaluate(({ powerMonitor }) => powerMonitor.emit('lock-screen'))
    await page.getByRole('heading', { name: '解锁保险库' }).waitFor()
    assert.equal(await button('放弃修改').count(), 0)
    await page.getByPlaceholder('主密码', { exact: true }).fill(password)
    await button('解锁').click()
    await page.getByRole('heading', { name: '全部条目' }).waitFor()
    pass('close and quit protect credential/project drafts, while system lock remains immediate')
  }
  if (!scenario || scenario === 'errors') {
    const item = await call('create_item', { item: { type: 'login', title: '读取失败样例', password: 'fixture-secret' } })
    await section('项目')
    await section('全部条目')
    await application.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('get_item')
      globalThis.readFailure = 'missing'
      ipcMain.handle('get_item', () => {
        if (globalThis.readFailure === 'missing') return null
        throw new Error(globalThis.readFailure)
      })
    })
    await button(item.title).click()
    await page.getByText('凭证已不存在，请刷新列表。', { exact: true }).waitFor()
    await application.evaluate(() => { globalThis.readFailure = 'DECRYPT_FAILED' })
    await button(item.title).click()
    await page.getByText('凭证解密失败，请从有效备份恢复。', { exact: true }).waitFor()
    await application.evaluate(() => { globalThis.readFailure = 'private-unexpected-diagnostic' })
    await button(item.title).click()
    await page.getByText('读取凭证失败，请重试。', { exact: true }).waitFor()
    assert.equal((await page.locator('body').innerText()).includes('private-unexpected-diagnostic'), false)
    pass('missing, unreadable and unknown failures produce actionable feedback without exposing raw errors')
  }
  assert.deepEqual(errors, [])
} finally {
  await page.screenshot({ path: join(output, `result-${scenario || 'all'}.png`) }).catch(() => {})
  await application.evaluate(({ app }) => app.exit()).catch(() => {})
  await application.close().catch(() => {})
  await writeFile(join(output, `report-${scenario || 'all'}.json`), JSON.stringify({ passed, errors, data }, null, 2))
}
