// Usage: node tests/brand-upgrade.mjs <legacy executable> <new executable>
// Both applications use an isolated fixture, never the user's actual vault.
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { _electron } from 'playwright-core'

assert.equal(process.argv.length, 4, 'Pass the legacy and new packaged executable paths')
const output = resolve('output/playwright/brand-upgrade')
await mkdir(output, { recursive: true })
const data = await mkdtemp(join(output, 'vault-'))
const backup = join(data, 'legacy.jvault')
const password = 'brand-upgrade-fixture-password'
const errors = [], report = []
let application, page, originalName, item
const call = (command, args) => page.evaluate(({ command, args }) => window.jiaziVault.invoke(command, args), { command, args })
const pass = (message) => { report.push(message); console.log('PASS', message) }

async function launch(executablePath) {
  application = await _electron.launch({ executablePath: resolve(executablePath), args: [`--user-data-dir=${data}`] })
  page = await application.firstWindow()
  page.setDefaultTimeout(15000)
  page.on('pageerror', error => errors.push(error.message))
  await page.waitForFunction(() => Boolean(window.jiaziVault))
  assert.equal(await application.evaluate(({ app }) => app.getPath('userData')), data)
}

async function unlock() {
  await page.getByRole('heading', { name: '解锁保险库' }).waitFor()
  await page.getByPlaceholder('主密码', { exact: true }).fill(password)
  await page.getByRole('button', { name: '解锁', exact: true }).click()
  await page.getByRole('heading', { name: '全部条目', exact: true }).waitFor()
}

try {
  await launch(process.argv[2])
  originalName = await application.evaluate(({ app }) => app.getName())
  await call('create_vault', { password })
  const project = await call('create_project', { project: { name: 'Atlas', icon: '📁', color: '#c7ef68', description: '品牌验收示例' } })
  item = await call('create_item', { item: { type: 'login', title: 'GitHub', username: 'demo-developer', password: 'fixture-secret', favorite: true, projectId: project.id } })
  await call('create_item', { item: { type: 'api-key', title: 'Production API', fields: { apiKey: 'fixture-api-key' }, environment: 'production', projectId: project.id, favorite: false } })
  await call('create_item', { item: { type: 'ssh', title: 'Development server', host: 'dev.example.invalid', fields: { privateKey: 'fixture-private-key' }, environment: 'development', favorite: false } })
  await application.evaluate(({ dialog }, backup) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: backup }) }, backup)
  await call('create_backup')
  assert.equal(JSON.parse(await readFile(backup, 'utf8')).format, 'jiazi-vault')
  await application.close()
  application = null
  pass('legacy packaged app created an encrypted vault and .jvault backup')

  await launch(process.argv[3])
  assert.equal(await application.evaluate(({ app }) => app.getName()), originalName)
  assert.equal(originalName, 'jiazi-vault')
  await unlock()
  assert.equal((await call('get_item', { id: item.id })).password, 'fixture-secret')
  assert.equal((await call('list_items', {})).length, 3)
  assert.equal((await call('list_projects'))[0].name, 'Atlas')
  assert.equal(await page.title(), 'Keystill · 密序')
  assert.equal(await page.locator('.brand').innerText(), 'Keystill\n密序 · 本地凭证管理')
  pass('new packaged app preserves internal identity and opens the legacy vault without migration')

  for (const [mode, label] of [['light', '浅色'], ['dark', '深色']]) {
    await page.getByRole('link', { name: '设置', exact: true }).click()
    await page.locator('.n-form-item').filter({ hasText: '主题' }).locator('.n-base-selection').click()
    await page.locator('.n-base-select-menu').getByText(label, { exact: true }).click()
    await page.waitForFunction(expected => getComputedStyle(document.querySelector('.app-shell')).backgroundColor === expected, mode === 'dark' ? 'rgb(32, 37, 31)' : 'rgb(239, 238, 232)')
    await page.getByRole('link', { name: '全部条目', exact: true }).click()
    await page.getByText('GitHub', { exact: true }).waitFor()
    await page.locator('.n-spin-content--spinning').waitFor({ state: 'hidden' })
    await page.screenshot({ path: join(output, `vault-${mode}.png`), animations: 'disabled' })
    await page.getByRole('button', { name: '锁定保险库', exact: true }).click()
    await page.getByRole('heading', { name: '解锁保险库' }).waitFor()
    await page.screenshot({ path: join(output, `unlock-${mode}.png`) })
    await unlock()
  }
  const images = await page.locator('img').evaluateAll(images => images.every(image => image.complete && image.naturalWidth > 0))
  assert.equal(images, true)
  pass('packaged logos load and light/dark themes work through settings and lock/unlock')

  await application.evaluate(({ dialog }, backup) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [backup] })
    dialog.showMessageBox = async () => ({ response: 1 })
  }, backup)
  assert.equal(await call('restore_backup', { password }), true)
  await unlock()
  assert.equal((await call('get_item', { id: item.id })).password, 'fixture-secret')
  pass('new packaged app restores the legacy encrypted backup and decrypts its credentials')
  await application.close()
  application = null
  await launch(process.argv[3])
  await unlock()
  assert.equal((await call('get_item', { id: item.id })).password, 'fixture-secret')
  pass('restored credentials remain readable after restarting the packaged app')
  assert.deepEqual(errors, [])
} catch (error) {
  errors.push(String(error))
  await page?.screenshot({ path: join(output, 'failure.png') }).catch(() => {})
  throw error
} finally {
  if (application) await application.close()
  await writeFile(join(output, 'report.json'), JSON.stringify({ data, report, errors }, null, 2))
}
