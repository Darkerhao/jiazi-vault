import assert from 'node:assert/strict'
import { mkdir, writeFile, readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createVaultThroughUI } from './onboarding.mjs'

const { _electron } = await import(pathToFileURL(process.env.JIAZI_PLAYWRIGHT_MODULE).href)
const root = process.cwd(), output = resolve(root, 'output/playwright')
const data = resolve(output, `batch3-data-${Date.now()}`)
await mkdir(data, { recursive: true })
const report = [], errors = []
const password = 'batch3-test-master-password'
let application, page, originalClipboard
const pass = (name) => { report.push(name); console.log('PASS ' + name) }
const call = (command, args) => page.evaluate(({ command, args }) => window.jiaziVault.invoke(command, args), { command, args })
async function launch() {
  application = await _electron.launch({ executablePath: resolve(root, 'node_modules/electron/dist/electron.exe'), args: [resolve(root, 'tests/electron-launch.cjs')], cwd: root, env: { ...process.env, JIAZI_TEST_DATA: data } })
  page = await application.firstWindow()
  page.setDefaultTimeout(12_000)
  page.on('pageerror', (error) => errors.push(error.message))
  await page.getByRole('heading', { name: /欢迎使用 Jiazi Vault|解锁保险库/ }).waitFor()
}
async function section(name) {
  await page.getByRole('link', { name, exact: true }).click()
  await page.getByRole('heading', { name, exact: true }).waitFor()
}
async function unlock() {
  await page.getByPlaceholder('主密码', { exact: true }).fill(password)
  await page.getByRole('button', { name: '解锁', exact: true }).click()
  await page.getByRole('heading', { name: '全部条目' }).waitFor()
}
async function dialogs(options) {
  await application.evaluate(({ dialog, ipcMain }, values) => {
    globalThis.testDialogs = []
    dialog.showMessageBox = async (_window, config) => {
      globalThis.testDialogs.push({ kind: 'confirm', ...config })
      if (values.lockAt === 'confirm') ipcMain.emit('lock-screen-test')
      return { response: values.response ?? 1, checkboxChecked: false }
    }
    dialog.showSaveDialog = async (_window, config) => {
      globalThis.testDialogs.push({ kind: 'save', ...config })
      if (values.lockAt === 'save') ipcMain.emit('lock-screen-test')
      return { canceled: Boolean(values.cancelFile), filePath: values.path }
    }
    dialog.showOpenDialog = async () => ({ canceled: Boolean(values.cancelFile), filePaths: [values.path] })
  }, options)
}
async function setDeleted(id, deletedAt) {
  await application.evaluate(async ({ app }, args) => {
    const { DatabaseSync } = process.getBuiltinModule('node:sqlite')
    const db = new DatabaseSync(app.getPath('userData') + '/vault.db')
    db.prepare('UPDATE items SET deleted_at = ? WHERE id = ?').run(args.deletedAt, args.id)
    db.close()
  }, { id, deletedAt })
}
try {
  await launch()
  originalClipboard = await application.evaluate(async ({ clipboard }) => clipboard.readText())
  await application.evaluate(({ ipcMain, powerMonitor }) => ipcMain.on('lock-screen-test', () => powerMonitor.emit('lock-screen')))
  await createVaultThroughUI(page, password)
  const first = await call('create_item', { item: { type: 'password', title: 'Viewed Credential', password: 'first-secret', favorite: false } })
  const second = await call('create_item', { item: { type: 'password', title: 'Copied Credential', password: 'second-secret', favorite: false } })
  const never = await call('create_item', { item: { type: 'password', title: 'Never Used', password: 'never-secret', favorite: false } })
  await section('设置')
  await section('最近使用')
  await page.getByText('还没有最近使用记录').waitFor()
  await section('全部条目')
  await page.getByText('Viewed Credential', { exact: true }).click()
  await page.getByRole('dialog').waitFor()
  await page.getByRole('button', { name: '取消', exact: true }).click()
  await section('最近使用')
  await page.getByText('Viewed Credential', { exact: true }).waitFor()
  assert.equal(await page.locator('.item-title').count(), 1)
  const viewedAt = (await call('get_item', { id: first.id, recordAccess: false })).lastAccessedAt
  assert.ok(viewedAt)
  assert.equal((await call('get_item', { id: first.id, recordAccess: false })).updatedAt, first.updatedAt)
  pass('actual editor view populates recent; untouched credentials absent; modification time unchanged')

  await application.evaluate(({ clipboard }) => {
    globalThis.originalWriteText = clipboard.writeText
    clipboard.writeText = async () => { throw new Error('test clipboard failure') }
  })
  await assert.rejects(call('copy_to_clipboard', { text: 'second-secret', itemId: second.id }), /test clipboard failure/)
  await application.evaluate(({ clipboard }) => { clipboard.writeText = globalThis.originalWriteText })
  assert.equal((await call('get_item', { id: second.id, recordAccess: false })).lastAccessedAt, undefined)
  pass('failed clipboard write does not record usage')

  await page.keyboard.press('Control+k')
  await page.getByPlaceholder('搜索名称、项目、环境、账号…').fill('Copied Credential')
  await page.getByRole('button', { name: '复制密码', exact: true }).click()
  await page.getByText('已复制到剪贴板', { exact: true }).waitFor()
  assert.equal(await application.evaluate(async ({ clipboard }) => clipboard.readText()), 'second-secret')
  await page.keyboard.press('Escape')
  assert.equal(await page.locator('.item-title').first().innerText(), 'Copied Credential')
  assert.equal((await call('get_item', { id: never.id, recordAccess: false })).lastAccessedAt, undefined)
  pass('quick search successful clipboard copy updates recent immediately')

  await section('设置')
  const jsonPath = resolve(data, 'export.json'), csvPath = resolve(data, 'export.csv')
  await dialogs({ response: 0, path: jsonPath })
  await page.getByRole('button', { name: '导出 JSON', exact: true }).click()
  await page.getByRole('button', { name: '导出 JSON', exact: true }).waitFor({ state: 'visible' })
  await page.waitForFunction(() => !document.body.innerText.includes('正在处理…'))
  assert.ok(!(await readdir(data)).includes('export.json'))
  const canceled = await application.evaluate(() => globalThis.testDialogs)
  assert.equal(canceled.length, 1)
  assert.equal(canceled[0].defaultId, 0)
  assert.equal(canceled[0].cancelId, 0)
  pass('export native warning defaults to cancel; cancellation writes no file')

  for (const [format, path] of [['json', jsonPath], ['csv', csvPath]]) {
    await dialogs({ path })
    await page.getByRole('button', { name: `导出 ${format.toUpperCase()}`, exact: true }).click()
    await page.getByText(`明文文件已保存：export.${format}`, { exact: true }).waitFor()
    assert.ok((await readFile(path, 'utf8')).includes('first-secret'))
    const choices = await application.evaluate(() => globalThis.testDialogs)
    assert.deepEqual(choices.map((choice) => choice.kind), ['confirm', 'save'])
  }
  assert.equal((await call('get_item', { id: first.id, recordAccess: false })).lastAccessedAt, viewedAt)
  pass('JSON and CSV UI export real files after confirmation without recording usage')

  await dialogs({ path: jsonPath, response: 0 })
  assert.equal(await call('import_plaintext'), null)
  assert.equal((await call('list_items', {})).length, 3)
  await dialogs({ path: jsonPath })
  await page.getByRole('button', { name: '导入 JSON / CSV', exact: true }).click()
  await page.getByText('已导入 3 条凭证', { exact: true }).waitFor()
  assert.equal((await call('list_items', {})).length, 6)
  await dialogs({ path: csvPath })
  assert.equal(await call('import_plaintext'), 3)
  assert.equal((await call('list_items', {})).length, 9)
  pass('import cancellation is inert; JSON and CSV append with fresh IDs')

  const invalidPath = resolve(data, 'invalid.json')
  await writeFile(invalidPath, '[{"type":"login","title":"valid"},{"type":"broken","title":"PRIVATE"}]')
  await dialogs({ path: invalidPath })
  await assert.rejects(call('import_plaintext'), /IMPORT_FAILED/)
  assert.equal((await call('list_items', {})).length, 9)
  pass('invalid later row produces generic error and no partial import')

  const customPath = resolve(data, 'custom.json')
  await writeFile(customPath, JSON.stringify([{ type: 'custom', title: 'Imported Custom', password: 'custom-password', fields: { token: 'custom-token' }, host: 'keep-host' }]))
  await dialogs({ path: customPath })
  await call('import_plaintext')
  await section('全部条目')
  await page.getByText('Imported Custom', { exact: true }).click()
  await page.getByRole('button', { name: '显示token', exact: true }).click()
  await page.getByPlaceholder('token', { exact: true }).fill('updated-token')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await page.getByPlaceholder('凭证名称').waitFor({ state: 'hidden' })
  const custom = (await call('list_items', {})).find((item) => item.title === 'Imported Custom')
  const fullCustom = await call('get_item', { id: custom.id, recordAccess: false })
  assert.equal(fullCustom.type, 'custom')
  assert.equal(fullCustom.fields.token, 'updated-token')
  assert.equal(fullCustom.host, 'keep-host')
  pass('imported custom type and extra fields survive editing')

  for (const lockAt of ['confirm', 'save']) {
    await dialogs({ path: resolve(data, `locked-${lockAt}.json`), lockAt })
    await assert.rejects(call('export_plaintext', { format: 'json' }), /EXPORT_FAILED/)
    assert.ok(!(await readdir(data)).includes(`locked-${lockAt}.json`))
    await page.getByRole('heading', { name: '解锁保险库' }).waitFor()
    await assert.rejects(call('import_plaintext'), /VAULT_LOCKED/)
    await unlock()
  }
  await dialogs({ path: jsonPath, lockAt: 'confirm' })
  const before = (await call('list_items', {})).length
  await assert.rejects(call('import_plaintext'), /IMPORT_FAILED/)
  await page.getByRole('heading', { name: '解锁保险库' }).waitFor()
  await unlock()
  assert.equal((await call('list_items', {})).length, before)
  pass('lock during export warning, save dialog or import confirmation cancels operation')

  const expired = await call('create_item', { item: { type: 'password', title: 'Expired', favorite: false } })
  const pending = await call('create_item', { item: { type: 'password', title: 'Pending', favorite: false } })
  await setDeleted(expired.id, Date.now() - 30 * 86400000 - 1)
  await setDeleted(pending.id, Date.now() - 29 * 86400000)
  await section('设置')
  await section('回收站')
  await page.getByText('Pending', { exact: true }).waitFor()
  assert.equal(await page.getByText('Expired', { exact: true }).count(), 0)
  await page.getByText('凭证移入回收站满 30 天后自动永久删除，无法恢复。').waitFor()
  await page.getByRole('button', { name: '恢复', exact: true }).click()
  await page.getByText('回收站是空的').waitFor()
  await assert.rejects(call('restore_item', { id: expired.id }), /ITEM_NOT_FOUND/)
  pass('trash purges expired entries, displays retention, restores unexpired entries')

  await application.close()
  await launch()
  await unlock()
  assert.equal((await call('get_item', { id: first.id, recordAccess: false })).lastAccessedAt, viewedAt)
  await section('最近使用')
  assert.ok(await page.locator('.item-title').count() >= 2)
  await page.screenshot({ path: resolve(output, 'batch3-recent.png') })
  await section('设置')
  await page.screenshot({ path: resolve(output, 'batch3-settings.png') })
  assert.deepEqual(errors, [])
  pass('restart preserves actual usage; production renderer has no uncaught errors')
} catch (error) {
  errors.push(String(error))
  if (page) await page.screenshot({ path: resolve(output, 'batch3-failure.png') }).catch(() => {})
  throw error
} finally {
  if (application) {
    await call('lock_vault').catch(() => {})
    if (originalClipboard !== undefined) await application.evaluate(async ({ clipboard }, text) => clipboard.writeText(text), originalClipboard).catch(() => {})
    await application.close().catch(() => {})
  }
  await writeFile(resolve(output, 'batch3-smoke-report.json'), JSON.stringify({ report, errors, data, boundaries: 'Isolated real Electron/SQLite/clipboard; file paths and native dialog responses injected; lock-screen event simulated, no physical OS lock/suspend.' }, null, 2))
}
