import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createVaultThroughUI } from './onboarding.mjs'

const { _electron } = await import(pathToFileURL(process.env.JIAZI_PLAYWRIGHT_MODULE).href)
const root = process.cwd(), output = resolve(root, 'output/playwright')
const step = process.env.JIAZI_BIOMETRIC_STEP || 'all'
assert.ok(['all', 'cancel', 'disable'].includes(step))
const installed = process.env.JIAZI_INSTALLED_EXE
const data = resolve(process.env.JIAZI_BIOMETRIC_DATA || resolve(output, `biometric-data-${Date.now()}`))
assert.ok(data.startsWith(output + '/') || data.startsWith(output + '\\'), 'Use only an isolated test vault inside output/playwright')
await mkdir(data, { recursive: true })
const password = 'biometric-test-master-password'
const report = [], errors = []
let application, page
const pass = (name) => { report.push(name); console.log('PASS ' + name) }
const call = (command, args) => page.evaluate(({ command, args }) => window.jiaziVault.invoke(command, args), { command, args })
async function launch() {
  application = await _electron.launch({ executablePath: installed || resolve(root, 'node_modules/electron/dist/electron.exe'), args: installed ? [`--user-data-dir=${data}`] : [resolve(root, 'tests/electron-launch.cjs')], cwd: root, env: { ...process.env, JIAZI_TEST_DATA: data } })
  page = await application.firstWindow()
  page.setDefaultTimeout(15000)
  page.on('pageerror', (error) => errors.push(error.message))
}
try {
  await launch()
  if (step === 'all') {
    await createVaultThroughUI(page, password)
    const item = await call('create_item', { item: { type: 'password', title: 'Biometric Credential', password: 'fixture-secret', favorite: false } })
    await page.getByRole('link', { name: '设置', exact: true }).click()
    assert.equal((await call('get_biometric_status')).available, true)
    await page.getByPlaceholder('启用前验证主密码').fill(password)
    console.log('ACTION 1: approve OS authentication to enroll the isolated test vault')
    await page.getByRole('button', { name: '启用系统快捷解锁', exact: true }).click()
    await page.getByRole('button', { name: '关闭系统快捷解锁', exact: true }).waitFor({ timeout: 120000 })
    assert.equal((await call('get_biometric_status')).enabled, true)
    pass('real OS authentication and OS-protected key storage enroll successfully')
    await application.close()
    await launch()
    await page.getByRole('button', { name: '使用 Windows Hello 解锁', exact: true }).waitFor()
    console.log('ACTION 2: approve OS authentication to unlock after restarting')
    await page.getByRole('button', { name: '使用 Windows Hello 解锁', exact: true }).click()
    await page.getByRole('heading', { name: '全部条目' }).waitFor({ timeout: 120000 })
    assert.equal((await call('get_item', { id: item.id })).password, 'fixture-secret')
    pass('after restarting, Windows Hello unlocks the persisted encrypted credential without the master password')
    await call('lock_vault')
  }
  if (step !== 'disable') {
    await page.getByRole('button', { name: '使用 Windows Hello 解锁', exact: true }).waitFor()
    console.log('ACTION: cancel OS authentication; the vault must stay locked')
    await page.getByRole('button', { name: '使用 Windows Hello 解锁', exact: true }).click()
    await page.waitForFunction(() => document.body.textContent.includes('系统认证已取消或失败，可重试或使用主密码解锁。') || [...document.querySelectorAll('h1')].some((heading) => heading.textContent === '全部条目'), undefined, { timeout: 120000 })
    assert.equal((await call('get_vault_status')).unlocked, false, 'The third OS verification succeeded; cancellation was not exercised')
    await assert.rejects(call('list_items'), /VAULT_LOCKED/)
    pass('canceling the real OS dialog keeps the vault locked and sensitive IPC denied')
  }
  await page.getByRole('heading', { name: '解锁保险库' }).waitFor()
  await page.getByPlaceholder('主密码', { exact: true }).fill(password)
  await page.getByRole('button', { name: '解锁', exact: true }).click()
  await page.getByRole('heading', { name: '全部条目' }).waitFor()
  await page.getByRole('link', { name: '设置', exact: true }).click()
  await page.getByRole('button', { name: '关闭系统快捷解锁', exact: true }).click()
  await page.getByRole('button', { name: '启用系统快捷解锁', exact: true }).waitFor()
  assert.equal((await call('get_biometric_status')).enabled, false)
  await call('lock_vault')
  await assert.rejects(call('unlock_biometric'), /BIOMETRIC_UNAVAILABLE/)
  assert.deepEqual(errors, [])
  pass('master password remains usable and disabling deletes enrollment and prevents subsequent biometric unlock')
} catch (error) {
  errors.push(String(error))
  throw error
} finally {
  await application?.close().catch(() => {})
  await writeFile(resolve(output, step === 'all' ? 'biometric-smoke-report.json' : `biometric-${step}-report.json`), JSON.stringify({ report, errors, data, installed, boundaries: 'User-assisted real Windows Hello dialogs and real Electron safeStorage; isolated fixture vault; not a macOS or Windows lock-screen/suspend test.' }, null, 2))
}
