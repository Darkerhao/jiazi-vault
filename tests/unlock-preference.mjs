import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import electron from 'electron'
import { _electron } from 'playwright-core'
import { openDatabase } from '../dist-electron/database.js'
import { createVaultCredential, clearKey } from '../dist-electron/vault-crypto.js'

const root = process.cwd(), output = resolve(root, 'output/playwright')
await mkdir(output, { recursive: true })
const data = await mkdtemp(join(output, 'unlock-preference-'))
const password = 'unlock-preference-fixture-password'
const { connection: db } = openDatabase(data)
const credential = await createVaultCredential(password)
try { db.prepare('INSERT INTO vault_metadata VALUES (?, ?)').run('vault', JSON.stringify(credential.metadata)) }
finally { clearKey(credential.masterKey); db.close() }

const report = [], errors = []
let application, page
const pass = (message) => { report.push(message); console.log('PASS ' + message) }
const call = (command, args) => page.evaluate(({ command, args }) => window.jiaziVault.invoke(command, args), { command, args })
const hello = () => page.getByRole('button', { name: '使用 Windows Hello 解锁', exact: true })
const passwordInput = () => page.getByPlaceholder('主密码', { exact: true })
const unlocked = () => page.getByRole('heading', { name: '全部条目', exact: true }).waitFor()
const locked = () => page.getByRole('heading', { name: '解锁保险库', exact: true }).waitFor()
const configure = (patch) => application.evaluate((_electron, patch) => Object.assign(globalThis.biometricFixture, patch), patch)

async function launch() {
  application = await _electron.launch({ executablePath: electron, args: [resolve(root, 'tests/electron-launch.cjs')], cwd: root, env: { ...process.env, JIAZI_TEST_DATA: data } })
  page = await application.firstWindow()
  page.setDefaultTimeout(10000)
  page.on('pageerror', (error) => errors.push(error.message))
  await locked()
  // Only the OS boundary is simulated; UI, IPC, session checks, key verification and SQLite are real.
  await application.evaluate((_electron, modulePath) => {
    const { BiometricVault } = process.getBuiltinModule('module').createRequire(modulePath)(modulePath)
    const status = BiometricVault.prototype.status
    globalThis.biometricFixture = { available: true, canceled: false, calls: 0 }
    BiometricVault.prototype.status = function () {
      const state = globalThis.biometricFixture
      this.provider = {
        label: 'Windows Hello', available: async () => state.available,
        verify: async () => { state.calls++; if (state.canceled) throw new Error('BIOMETRIC_CANCELED_OR_FAILED') },
        protect: async (key) => Buffer.from(key), unprotect: async (encrypted) => Buffer.from(encrypted),
      }
      return status.call(this)
    }
  }, resolve(root, 'dist-electron/biometric-vault.js'))
  await page.reload()
  await locked()
}

async function unlockPassword() {
  const fallback = page.getByRole('button', { name: '使用主密码解锁', exact: true })
  if (await fallback.isVisible()) await fallback.click()
  await passwordInput().fill(password)
  await page.getByRole('button', { name: '解锁', exact: true }).click()
  await unlocked()
}

try {
  await launch()
  await unlockPassword()
  await call('enable_biometric', { password })
  await call('lock_vault')
  await locked()
  assert.equal((await call('get_biometric_status')).preferred, false)
  assert.equal(await passwordInput().isVisible(), true)
  await configure({ canceled: true })
  await hello().click()
  await page.getByText('系统认证已取消或失败，可重试或使用主密码解锁。', { exact: true }).waitFor()
  assert.equal((await call('get_biometric_status')).preferred, false)
  assert.equal((await call('get_vault_status')).unlocked, false)
  await configure({ canceled: false })
  await hello().click()
  await unlocked()
  assert.equal((await call('get_biometric_status')).preferred, true)
  pass('enrollment and cancellation keep the password default; successful biometric unlock records the preference')

  await application.close()
  await launch()
  assert.equal(await passwordInput().count(), 0)
  assert.equal(await hello().evaluate((button) => button === document.activeElement), true)
  assert.equal((await configure({})).calls, 0)
  await page.screenshot({ path: join(output, 'unlock-preference-hello.png') })
  await configure({ canceled: true })
  await page.keyboard.press('Enter')
  await page.getByText('系统认证已取消或失败，可重试或使用主密码解锁。', { exact: true }).waitFor()
  assert.equal((await configure({})).calls, 1)
  assert.equal((await call('get_vault_status')).unlocked, false)
  await page.getByRole('button', { name: '使用主密码解锁', exact: true }).click()
  assert.equal(await passwordInput().evaluate((input) => input === document.activeElement), true)
  await unlockPassword()
  assert.equal((await call('get_biometric_status')).preferred, true)
  pass('restart selects and focuses Hello; Enter requests one verification; cancellation allows password fallback without losing the preference')

  await configure({ canceled: false })
  await call('lock_vault')
  await locked()
  assert.equal(await passwordInput().count(), 0)
  await page.keyboard.press('Enter')
  await unlocked()
  await configure({ available: false })
  await call('lock_vault')
  await locked()
  assert.equal(await passwordInput().isVisible(), true)
  await page.getByText('Windows Hello 当前不可用，请使用主密码解锁。', { exact: true }).waitFor()
  await page.screenshot({ path: join(output, 'unlock-preference-password.png') })
  await unlockPassword()
  pass('relocking retains the default and keyboard unlock works; unavailable Hello automatically shows the password form')

  await call('disable_biometric')
  await call('lock_vault')
  await locked()
  assert.equal(await passwordInput().isVisible(), true)
  assert.equal(await hello().count(), 0)
  assert.equal((await call('get_biometric_status')).preferred, false)
  await application.close()
  await launch()
  assert.equal(await passwordInput().isVisible(), true)
  assert.equal((await call('get_biometric_status')).preferred, false)
  pass('disabling biometric unlock clears the preference across restart')
  assert.deepEqual(errors, [])
} catch (error) {
  errors.push(String(error))
  throw error
} finally {
  await application?.close().catch(() => {})
  await writeFile(join(output, 'unlock-preference-report.json'), JSON.stringify({ report, errors, data, boundaries: 'Production Electron UI, IPC, SQLite and crypto; simulated OS authentication and key protection, no real Windows Hello or Touch ID verification.' }, null, 2))
}
