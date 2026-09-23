import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const { _electron } = await import(pathToFileURL(process.env.JIAZI_PLAYWRIGHT_MODULE).href)
const root = process.cwd(), output = resolve(root, 'output/playwright')
const data = resolve(output, `access-data-${Date.now()}`)
const installed = process.env.JIAZI_INSTALLED_EXE
await mkdir(data, { recursive: true })
const report = [], errors = []
const password = 'access-test-master-password', nextPassword = 'updated-test-master-password'
let application, page, status
const pass = (name) => { report.push(name); console.log('PASS ' + name) }
const call = (command, args) => page.evaluate(({ command, args }) => window.jiaziVault.invoke(command, args), { command, args })
async function launch() {
  application = await _electron.launch({
    executablePath: installed || resolve(root, 'node_modules/electron/dist/electron.exe'),
    args: installed ? [`--user-data-dir=${data}`] : [resolve(root, 'tests/electron-launch.cjs')], cwd: root,
    env: { ...process.env, JIAZI_TEST_DATA: data },
  })
  page = await application.firstWindow()
  page.setDefaultTimeout(15000)
  page.on('pageerror', (error) => errors.push(error.message))
  assert.equal(await application.evaluate(({ app }) => app.getPath('userData')), data)
}
async function unlock(value) {
  await page.getByRole('heading', { name: '解锁保险库' }).waitFor()
  await page.getByPlaceholder('主密码', { exact: true }).fill(value)
  await page.getByRole('button', { name: '解锁', exact: true }).click()
}
async function passwordFields(current, next, confirm = next) {
  await page.getByPlaceholder('当前主密码', { exact: true }).fill(current)
  await page.getByPlaceholder('新主密码（至少 8 个字符）').fill(next)
  await page.getByPlaceholder('确认新主密码', { exact: true }).fill(confirm)
  await page.getByRole('button', { name: '修改主密码并锁定' }).click()
}
try {
  await launch()
  await page.getByRole('heading', { name: '欢迎使用 Jiazi Vault' }).waitFor()
  assert.equal(await page.locator('input[type="password"]').count(), 0)
  assert.equal((await call('get_vault_status')).exists, false)
  await page.screenshot({ path: resolve(output, 'access-welcome.png') })
  await page.getByRole('button', { name: '开始创建', exact: true }).click()
  await page.getByPlaceholder('主密码', { exact: true }).fill('short')
  await page.getByRole('button', { name: '下一步', exact: true }).click()
  await page.getByText('主密码至少需要 8 个字符。', { exact: true }).waitFor()
  await page.getByPlaceholder('主密码', { exact: true }).fill(password)
  await page.getByRole('button', { name: '下一步', exact: true }).click()
  await page.getByPlaceholder('确认主密码', { exact: true }).fill('mismatched-password')
  await page.getByRole('button', { name: '下一步', exact: true }).click()
  await page.getByText('两次输入的主密码不一致。').waitFor()
  await page.getByPlaceholder('确认主密码', { exact: true }).fill(password)
  await page.getByRole('button', { name: '下一步', exact: true }).click()
  assert.equal(await page.getByRole('button', { name: '创建保险库', exact: true }).isDisabled(), true)
  assert.equal((await call('get_vault_status')).exists, false)
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: '上一步', exact: true }).click()
  await page.getByRole('button', { name: '下一步', exact: true }).click()
  assert.equal(await page.getByRole('button', { name: '创建保险库', exact: true }).isDisabled(), true)
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: '创建保险库', exact: true }).click()
  await page.getByRole('heading', { name: '全部条目' }).waitFor()
  pass('four onboarding steps validate password and confirmation, require acknowledgement and create only on final action')

  const item = await call('create_item', { item: { type: 'custom', title: 'Access Credential', fields: { token: 'first\nsecond', empty: '' }, password: 'credential-secret', favorite: true } })
  const trash = await call('create_item', { item: { type: 'ssh', title: 'Trash Credential', fields: { privateKey: 'private-key' }, favorite: false } })
  await call('delete_item', { id: trash.id })
  const before = [await call('get_item', { id: item.id, recordAccess: false }), await call('get_item', { id: trash.id, recordAccess: false })]
  await page.getByRole('link', { name: '设置', exact: true }).click()
  await passwordFields(password, 'short')
  await page.getByText('主密码至少需要 8 个字符。', { exact: true }).waitFor()
  await passwordFields(password, nextPassword, 'different-password')
  await page.getByText('两次输入的新主密码不一致。', { exact: true }).waitFor()
  await passwordFields(password, password)
  await page.getByText('新主密码必须与当前主密码不同。').waitFor()
  await passwordFields('wrong-old-password', nextPassword)
  await page.getByText('当前主密码不正确。', { exact: true }).waitFor()
  assert.equal((await call('get_vault_status')).unlocked, true)
  assert.deepEqual(await call('get_item', { id: item.id, recordAccess: false }), before[0])
  await assert.rejects(call('change_master_password', { currentPassword: password, newPassword: 'short' }), /PASSWORD_TOO_SHORT/)
  pass('UI and direct IPC reject weak or incorrect passwords, mismatch and reuse without losing data')

  status = await call('get_biometric_status')
  assert.equal(status.enabled, false)
  assert.equal(status.label, process.platform === 'win32' ? 'Windows Hello' : process.platform === 'darwin' ? 'Touch ID' : '生物识别')
  await assert.rejects(call('unlock_biometric'), /BIOMETRIC_UNAVAILABLE/)
  await assert.rejects(call('enable_biometric', { password: 'wrong-old-password' }), /INVALID_PASSWORD/)
  pass('device capability is read from the OS; unregistered biometric unlock and wrong enrollment password are rejected')

  await page.getByText('保险库安全', { exact: true }).scrollIntoViewIfNeeded()
  await page.screenshot({ path: resolve(output, installed ? 'installed-access-settings.png' : 'access-settings.png') })
  await passwordFields(password, nextPassword)
  await page.getByRole('heading', { name: '解锁保险库' }).waitFor()
  await assert.rejects(call('get_item', { id: item.id }), /VAULT_LOCKED/)
  await assert.rejects(call('change_master_password', { currentPassword: nextPassword, newPassword: password }), /VAULT_LOCKED/)
  await assert.rejects(call('enable_biometric', { password: nextPassword }), /VAULT_LOCKED/)
  await unlock(password)
  await page.getByText('无法解锁保险库，请检查主密码。').waitFor()
  await unlock(nextPassword)
  await page.getByRole('heading', { name: '全部条目' }).waitFor()
  assert.deepEqual([await call('get_item', { id: item.id, recordAccess: false }), await call('get_item', { id: trash.id, recordAccess: false })], before)
  pass('successful password change locks immediately, rejects old password and preserves active and trashed credentials')

  await application.close()
  await launch()
  await unlock(nextPassword)
  await page.getByRole('heading', { name: '全部条目' }).waitFor()
  assert.deepEqual(await call('get_item', { id: item.id, recordAccess: false }), before[0])
  assert.deepEqual(errors, [])
  pass('restart accepts the new password and persists complete credential values without renderer errors')
} catch (error) {
  errors.push(String(error))
  throw error
} finally {
  await application?.close().catch(() => {})
  await writeFile(resolve(output, installed ? 'installed-access-report.json' : 'access-smoke-report.json'), JSON.stringify({ report, errors, status, data, installed, boundaries: 'Real UI, IPC, SQLite and crypto; real OS availability only, no successful biometric user verification in this automated script.' }, null, 2))
}
