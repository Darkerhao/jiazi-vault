import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import electron from 'electron'
import { _electron } from 'playwright-core'
import { openDatabase } from '../dist-electron/database.js'
import { createVaultCredential, clearKey } from '../dist-electron/vault-crypto.js'
import { writeDesktopPreferences } from '../dist-electron/settings.js'

const output = resolve('output/playwright')
const password = 'startup-fixture-master-password'
await mkdir(output, { recursive: true })

async function fixture(withVault = true) {
  const data = await mkdtemp(join(output, 'startup-'))
  const db = openDatabase(data)
  try {
    if (withVault) {
      const credential = await createVaultCredential(password)
      db.connection.prepare('INSERT INTO vault_metadata VALUES (?, ?)').run('vault', JSON.stringify(credential.metadata))
      clearKey(credential.masterKey)
    }
  } finally { db.connection.close() }
  return data
}

async function launch(t, data) {
  const id = `com.jiazi.vault.test.${data.split(/[\\/]/).at(-1)}`
  const env = { ...process.env, JIAZI_TEST_DATA: data, JIAZI_TEST_APP_ID: id }
  const args = [resolve('tests/startup-launch.cjs')]
  const application = await _electron.launch({ executablePath: electron, args, cwd: process.cwd(), env })
  t.after(async () => {
    await application.close().catch(() => {})
    // Remove only this test's native startup values, including after an assertion failure.
    if (process.platform === 'win32') for (const key of ['Run', 'Explorer\\StartupApproved\\Run']) {
      await promisify(execFile)('reg.exe', ['delete', `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\${key}`, '/v', id, '/f'], { windowsHide: true }).catch(() => {})
    }
  })
  const page = await application.firstWindow()
  page.setDefaultTimeout(8000)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  t.after(() => assert.deepEqual(errors, []))
  const call = (command, args) => page.evaluate(({ command, args }) => window.jiaziVault.invoke(command, args), { command, args })
  await page.waitForFunction(() => !!window.jiaziVault)
  await application.evaluate(() => globalThis.startupWindowReady.then(() => true))
  const unlock = async () => {
    await page.getByPlaceholder('主密码', { exact: true }).fill(password)
    await page.getByRole('button', { name: '解锁', exact: true }).click()
    await page.getByRole('heading', { name: '全部条目', exact: true }).waitFor()
  }
  const settings = async () => {
    await page.getByRole('menuitem', { name: '设置', exact: true }).click()
    await page.getByRole('switch', { name: '静默启动', exact: true }).waitFor()
  }
  const visible = () => application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible())
  return { application, page, call, unlock, settings, visible, id, env, args }
}

test('settings use native startup state, persist silent start and close behavior, and restore via tray or second launch', async t => {
  const data = await fixture()
  let current = await launch(t, data)
  let { application, page, call, unlock, settings } = current
  await page.getByRole('heading', { name: '解锁保险库' }).waitFor()
  assert.equal(await current.visible(), true)
  assert.deepEqual(await call('get_desktop_preferences'), { silentStart: false, closeToTray: true, startupSupported: ['win32', 'darwin'].includes(process.platform), openAtLogin: false })
  await assert.rejects(call('set_desktop_preference', { key: 'silentStart', value: true }), /VAULT_LOCKED/)
  await unlock()
  await settings()
  for (const args of [{ key: 'silentStart', value: 'true' }, { key: 'unknown', value: false }]) {
    await assert.rejects(call('set_desktop_preference', args), /INVALID_SETTINGS/)
  }

  if (process.platform === 'win32') {
    const startup = page.getByRole('switch', { name: '开机自启', exact: true })
    await startup.click()
    await page.waitForFunction(() => document.querySelector('[aria-labelledby="startup-login-label"]').getAttribute('aria-checked') === 'true')
    const native = await application.evaluate(({ app }) => app.getLoginItemSettings({ path: process.execPath, args: [] }))
    assert.equal(native.openAtLogin, true)
    assert.ok(native.launchItems.some(item => item.name === current.id && item.enabled))
    await application.evaluate(({ app }) => app.setLoginItemSettings({ openAtLogin: true, enabled: false, path: process.execPath, args: [] }))
    assert.equal((await call('get_desktop_preferences')).openAtLogin, false)
    await page.getByRole('menuitem', { name: '全部条目', exact: true }).click()
    await settings()
    assert.equal(await startup.getAttribute('aria-checked'), 'false')
    await startup.click()
    await page.waitForFunction(() => document.querySelector('[aria-labelledby="startup-login-label"]').getAttribute('aria-checked') === 'true')
    await startup.click()
    await page.waitForFunction(() => document.querySelector('[aria-labelledby="startup-login-label"]').getAttribute('aria-checked') === 'false')

    // A portable launch must register the durable outer executable, including paths with spaces.
    await application.evaluate(() => { process.env.PORTABLE_EXECUTABLE_FILE = `${process.env.JIAZI_TEST_DATA}\\Keystill Portable.exe` })
    await call('set_desktop_preference', { key: 'openAtLogin', value: true })
    const portable = await application.evaluate(({ app }) => app.getLoginItemSettings({ path: `"${process.env.PORTABLE_EXECUTABLE_FILE}"`, args: [] }))
    assert.equal(portable.openAtLogin, true)
    assert.ok(portable.launchItems.some(item => item.name === current.id && item.path.endsWith('Keystill Portable.exe')))
    await call('set_desktop_preference', { key: 'openAtLogin', value: false })
    await application.evaluate(() => { delete process.env.PORTABLE_EXECUTABLE_FILE })

    await application.evaluate(({ app }) => {
      globalThis.originalSetLogin = app.setLoginItemSettings
      app.setLoginItemSettings = () => {}
    })
    await startup.click()
    await page.getByRole('alert').filter({ hasText: '开机自启设置未生效' }).waitFor()
    assert.equal(await startup.getAttribute('aria-checked'), 'false')
    await application.evaluate(({ app }) => { app.setLoginItemSettings = globalThis.originalSetLogin })
  }

  await page.getByRole('switch', { name: '静默启动', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('[aria-labelledby="startup-silent-label"]').getAttribute('aria-checked') === 'true')
  assert.equal(await current.visible(), true)
  const card = page.locator('.startup-card')
  await card.screenshot({ path: join(output, 'startup-settings-light.png'), animations: 'disabled' })
  await call('update_settings', { settings: { themeMode: 'dark', clipboardClearTimeout: 15, autoLockMinutes: 15 } })
  await page.reload()
  await unlock()
  await settings()
  await card.screenshot({ path: join(output, 'startup-settings-dark.png'), animations: 'disabled' })
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 600))
  await page.setViewportSize({ width: 900, height: 600 })
  await card.scrollIntoViewIfNeeded()
  await card.screenshot({ path: join(output, 'startup-settings-900.png'), animations: 'disabled' })
  assert.equal(await card.evaluate(el => el.scrollWidth <= el.clientWidth), true)
  assert.equal(await card.evaluate(el => el.getBoundingClientRect().right <= window.innerWidth), true)

  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
  await page.getByRole('heading', { name: '解锁保险库' }).waitFor()
  assert.equal(await current.visible(), false)
  await application.evaluate(() => globalThis.startupTray.emit('double-click'))
  assert.equal(await current.visible(), true)
  // Even with close-to-tray enabled, the tray's Exit command terminates the process.
  const exit = application.waitForEvent('close')
  await application.evaluate(() => { setImmediate(() => globalThis.startupTrayMenu.items.find(item => item.label === '退出').click()) })
  await exit

  current = await launch(t, data)
  ;({ application, page, call, unlock, settings } = current)
  await page.getByRole('heading', { name: '解锁保险库' }).waitFor()
  assert.equal(await current.visible(), false)
  assert.equal(await application.evaluate(() => globalThis.startupWindowShows), 0)
  assert.equal((await call('get_desktop_preferences')).silentStart, true)
  const child = spawn(electron, current.args, { cwd: process.cwd(), env: current.env, windowsHide: true, stdio: 'ignore' })
  assert.equal(await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve) }), 0)
  assert.equal(await current.visible(), true)
  await unlock()
  await settings()
  await page.getByRole('switch', { name: '关闭时最小化到托盘', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('[aria-labelledby="startup-close-label"]').getAttribute('aria-checked') === 'false')
  await call('set_desktop_preference', { key: 'silentStart', value: false })
  const closed = application.waitForEvent('close')
  await application.evaluate(({ BrowserWindow }) => { setImmediate(() => BrowserWindow.getAllWindows()[0].close()) })
  await closed
  current = await launch(t, data)
  await current.page.getByRole('heading', { name: '解锁保险库' }).waitFor()
  assert.equal(await current.visible(), true)
  assert.equal((await current.call('get_desktop_preferences')).closeToTray, false)
})

test('first use remains visible with silent preference; corrupt database still shows recovery', async t => {
  const data = await fixture(false)
  const db = openDatabase(data)
  writeDesktopPreferences(db.connection, { silentStart: true, closeToTray: true })
  db.connection.close()
  const first = await launch(t, data)
  await first.page.getByRole('heading', { name: '欢迎使用 Keystill' }).waitFor()
  assert.equal(await first.visible(), true)
  await first.application.close()
  const corrupt = await mkdtemp(join(output, 'startup-corrupt-'))
  await writeFile(join(corrupt, 'vault.db'), 'test-only damaged database')
  const recovery = await launch(t, corrupt)
  await recovery.page.getByRole('heading', { name: '无法打开保险库' }).waitFor()
  assert.equal(await recovery.visible(), true)
})
