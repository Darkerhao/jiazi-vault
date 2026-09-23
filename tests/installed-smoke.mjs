import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createVaultThroughUI } from './onboarding.mjs'

const { _electron } = await import(pathToFileURL(process.env.JIAZI_PLAYWRIGHT_MODULE).href)
const root = process.cwd(), output = resolve(root, 'output/playwright')
const data = resolve(output, `installed-data-${Date.now()}`)
const executablePath = resolve(root, 'output/windows-install/Jiazi Vault.exe')
await mkdir(data, { recursive: true })
const report = [], errors = []
let application, page
const password = 'installed-test-master-password'
const pass = (name) => { report.push(name); console.log('PASS ' + name) }
const call = (command, args) => page.evaluate(({ command, args }) => window.jiaziVault.invoke(command, args), { command, args })
async function launch() {
  application = await _electron.launch({ executablePath, args: [`--user-data-dir=${data}`], cwd: root })
  page = await application.firstWindow()
  page.setDefaultTimeout(15000)
  page.on('pageerror', (error) => errors.push(error.message))
  assert.equal(await application.evaluate(({ app }) => app.getPath('userData')), data)
  assert.equal(await application.evaluate(({ app }) => app.isPackaged), true)
}
try {
  await launch()
  await createVaultThroughUI(page, password)
  const item = await call('create_item', { item: { type: 'password', title: 'Installed Credential', password: 'installed-secret', favorite: false } })
  assert.equal((await call('get_item', { id: item.id })).password, 'installed-secret')
  pass('installed executable loads packaged UI, native Argon2, SQLite and encrypted credential CRUD')
  const expired = await call('create_item', { item: { type: 'password', title: 'Timer expired', favorite: false } })
  const setExpired = (id) => application.evaluate(({ app }, itemId) => {
    const { DatabaseSync } = process.getBuiltinModule('node:sqlite')
    const db = new DatabaseSync(app.getPath('userData') + '/vault.db')
    db.prepare('UPDATE items SET deleted_at = ? WHERE id = ?').run(Date.now() - 30 * 86400000 - 1, itemId)
    db.close()
  }, id)
  await setExpired(expired.id)
  // No list/get call: wait for the actual one-minute timer to delete this row.
  const deadline = Date.now() + 65_000
  let exists = true
  while (exists && Date.now() < deadline) {
    await new Promise((done) => setTimeout(done, 2000))
    exists = await application.evaluate(({ app }, id) => {
      const { DatabaseSync } = process.getBuiltinModule('node:sqlite')
      const db = new DatabaseSync(app.getPath('userData') + '/vault.db')
      const row = db.prepare('SELECT 1 FROM items WHERE id = ?').get(id)
      db.close()
      return Boolean(row)
    }, expired.id)
  }
  assert.equal(exists, false)
  pass('actual scheduled cleanup deletes expired trash without user interaction')
  const resume = await call('create_item', { item: { type: 'password', title: 'Resume expired', favorite: false } })
  await setExpired(resume.id)
  await application.evaluate(({ powerMonitor }) => powerMonitor.emit('resume'))
  assert.equal(await call('get_item', { id: resume.id }), null)
  pass('resume event cleans expired trash')
  await application.close()
  await launch()
  await page.getByRole('heading', { name: '解锁保险库' }).waitFor()
  await page.getByPlaceholder('主密码', { exact: true }).fill(password)
  await page.getByRole('button', { name: '解锁', exact: true }).click()
  await page.getByRole('heading', { name: '全部条目' }).waitFor()
  assert.equal((await call('get_item', { id: item.id, recordAccess: false })).password, 'installed-secret')
  await page.getByRole('link', { name: '设置', exact: true }).click()
  await page.getByRole('button', { name: '导出 JSON', exact: true }).scrollIntoViewIfNeeded()
  await page.screenshot({ path: resolve(output, 'installed-transfer.png') })
  assert.deepEqual(errors, [])
  pass('installed app restart unlocks persisted data and displays transfer controls without renderer errors')
} catch (error) {
  errors.push(String(error))
  throw error
} finally {
  await application?.close().catch(() => {})
  await writeFile(resolve(output, 'installed-smoke-report.json'), JSON.stringify({ report, errors, executablePath, data, boundaries: 'Actual NSIS-installed binary and real 60s timer; isolated user-data-dir; resume event simulated.' }, null, 2))
}
