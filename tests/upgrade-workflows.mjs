import assert from 'node:assert/strict'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import electron from 'electron'
import { _electron } from 'playwright-core'
import { createVaultThroughUI } from './onboarding.mjs'
import { readBackup } from '../dist-electron/backup.js'
import { clearKey, decryptValue, unlockVaultCredential } from '../dist-electron/vault-crypto.js'

const root = process.cwd(), output = resolve(root, 'output/playwright')
const data = resolve(output, `upgrade-workflows-${Date.now()}`)
const password = 'upgrade-workflows-master-password'
const report = [], errors = []
let application, page
const pass = name => { report.push(name); console.log('PASS ' + name) }
const call = (command, args) => page.evaluate(({ command, args }) => window.jiaziVault.invoke(command, args), { command, args })
const modal = () => page.locator('.n-card.n-modal[role="dialog"]')
const item = id => call('get_item', { id, recordAccess: false })
async function openEditor(title) {
  await page.getByRole('button', { name: title, exact: true }).click()
  await modal().getByRole('button', { name: '编辑凭证', exact: true }).click()
}
async function save() {
  await modal().getByRole('button', { name: '保存', exact: true }).click()
  await modal().waitFor({ state: 'hidden' })
}
async function importEnv(source) {
  await modal().getByRole('button', { name: '导入 .env', exact: true }).click()
  await page.getByRole('textbox', { name: '.env 导入内容' }).fill(source)
  await modal().getByRole('button', { name: '预览解析结果' }).click()
}
try {
  await mkdir(data, { recursive: true })
  const installed = process.env.JIAZI_INSTALLED_EXE
  application = await _electron.launch({
    executablePath: installed || electron,
    args: installed ? [`--user-data-dir=${data}`] : [resolve(root, 'tests/electron-launch.cjs')],
    cwd: root, env: { ...process.env, JIAZI_TEST_DATA: data },
  })
  page = await application.firstWindow()
  page.setDefaultTimeout(15_000)
  page.on('pageerror', error => errors.push(error.message))
  await createVaultThroughUI(page, password)
  const a = await call('create_item', { item: { type: 'login', title: 'Health Duplicate A', password: 'fixture-shared-password' } })
  const b = await call('create_item', { item: { type: 'database', title: 'Health Duplicate B', password: 'fixture-shared-password' } })
  const short = await call('create_item', { item: { type: 'password', title: 'Health Short', password: 'short' } })
  const today = new Date()
  const expiry = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  const api = await call('create_item', { item: { type: 'api-key', title: 'Health Expiring', fields: { apiKey: 'fixture-api-secret', expiresAt: expiry } } })
  const trash = await call('create_item', { item: { type: 'password', title: 'Health Trash', password: 'short' } })
  await call('delete_item', { id: trash.id })
  await page.getByRole('link', { name: '凭证健康', exact: true }).click()
  await page.getByRole('heading', { name: '凭证健康' }).waitFor()
  await page.locator('.health-row').nth(3).waitFor()
  const result = await call('get_credential_health')
  assert.deepEqual(new Set(result.map(entry => entry.id)), new Set([a.id, b.id, short.id, api.id]))
  assert.ok(result.every(entry => Object.keys(entry).sort().join(',') === 'id,issues'))
  assert.equal((await item(a.id)).lastAccessedAt, undefined)
  const text = await page.locator('body').innerText()
  assert.ok(!text.includes('fixture-shared-password') && !text.includes('fixture-api-secret'))
  assert.ok(!text.includes('Health Trash'))
  await page.screenshot({ path: resolve(output, 'upgrade-health.png') })
  pass('health checks use real encrypted records, omit secrets and trash, and do not record access')

  await page.locator('.health-filter .n-select').click()
  await page.locator('.n-base-select-menu').getByText('密码重复使用', { exact: true }).click()
  assert.equal(await page.locator('.health-row').count(), 2)
  await page.getByRole('button', { name: '处理凭证Health Duplicate B' }).click()
  await modal().getByRole('button', { name: '编辑凭证', exact: true }).click()
  await modal().getByPlaceholder('密码', { exact: true }).fill('fixture-different-password')
  await save()
  await page.getByRole('link', { name: '凭证健康', exact: true }).click()
  await page.locator('.health-row').nth(1).waitFor()
  assert.equal(await page.locator('.health-row').count(), 2)
  assert.ok((await call('get_credential_health')).every(entry => !entry.issues.includes('reused-password')))
  await page.getByRole('button', { name: '重新检查', exact: true }).click()
  await page.locator('.health-row').nth(1).waitFor()
  pass('health filtering and navigation lead to editing; saved password changes resolve both reuse warnings')

  const original = { TOKEN: 'fixture-old-token', EMPTY: '', KEEP: 'fixture-keep-value', MULTI: 'first\nsecond' }
  const env = await call('create_item', { item: { type: 'env', title: 'Env Update', environment: 'production', fields: original } })
  await application.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
  }, data)
  await call('configure_automatic_backup', { enabled: true })
  await page.getByRole('link', { name: '全部条目', exact: true }).click()
  await openEditor('Env Update')
  await importEnv('TOKEN=fixture-new-token\nEMPTY=\nMULTI="first\nsecond"\nNEW=\n')
  const replace = modal().getByRole('checkbox', { name: '替换变量TOKEN', exact: true })
  assert.equal(await replace.isChecked(), false)
  assert.equal(await modal().getByRole('button', { name: '将 1 个变量加入编辑', exact: true }).isDisabled(), false)
  const previewText = await modal().innerText()
  assert.ok(!previewText.includes('fixture-old-token') && !previewText.includes('fixture-new-token'))
  await replace.check()
  await page.setViewportSize({ width: 900, height: 600 })
  await modal().getByRole('button', { name: '将 2 个变量加入编辑', exact: true }).scrollIntoViewIfNeeded()
  await page.screenshot({ path: resolve(output, 'upgrade-env-preview.png') })
  await modal().getByRole('button', { name: '将 2 个变量加入编辑', exact: true }).click()
  assert.deepEqual((await item(env.id)).fields, original)
  assert.equal(await modal().getByRole('textbox', { name: '变量名称', exact: true }).count(), 5)
  const saveButton = modal().getByRole('button', { name: '保存', exact: true })
  const bounds = await saveButton.boundingBox()
  assert.ok(bounds && bounds.y >= 0 && bounds.y + bounds.height <= 600)
  await save()
  const expected = { ...original, TOKEN: 'fixture-new-token', NEW: '' }
  assert.deepEqual((await item(env.id)).fields, expected)
  pass('env preview masks both values, requires replacement selection, preserves other variables and writes only on save')

  const history = await call('list_item_history', { id: env.id })
  assert.equal(history.length, 1)
  assert.deepEqual((await call('get_item_history', { id: env.id, historyId: history[0].id })).fields, original)
  const status = await call('get_automatic_backup_status')
  assert.equal(status.error, false)
  const latest = (await readdir(status.directory)).filter(name => name.endsWith('.jvault')).sort().at(-1)
  const backup = await readBackup(await readFile(join(status.directory, latest), 'utf8'), password)
  const key = await unlockVaultCredential(password, backup.metadata)
  try {
    const row = backup.items.find(row => row.id === env.id)
    assert.deepEqual(JSON.parse(decryptValue(key, JSON.parse(row.secret))).fields, expected)
  } finally { clearKey(key) }
  pass('env save records the previous fields in history and includes merged fields in the automatic encrypted backup')

  await openEditor('Env Update')
  await importEnv('TOKEN=fixture-unselected-token\nKEEP=fixture-unselected-keep\nNEW=\n')
  assert.equal(await modal().getByRole('button', { name: '将 0 个变量加入编辑', exact: true }).isDisabled(), true)
  await modal().getByRole('checkbox', { name: '替换变量TOKEN', exact: true }).check()
  await modal().getByRole('button', { name: '将 1 个变量加入编辑', exact: true }).click()
  await modal().getByRole('button', { name: '取消', exact: true }).click()
  await page.getByRole('button', { name: '放弃修改', exact: true }).click()
  await modal().waitFor({ state: 'hidden' })
  assert.deepEqual((await item(env.id)).fields, expected)
  pass('unchanged-only imports cannot apply; canceling a merged draft leaves saved values intact')

  await openEditor('Env Update')
  await importEnv('TOKEN=fixture-lock-preview')
  await modal().getByRole('checkbox', { name: '替换变量TOKEN', exact: true }).check()
  await call('lock_vault')
  await page.getByRole('heading', { name: '解锁保险库' }).waitFor()
  assert.equal(await page.getByRole('checkbox', { name: '替换变量TOKEN', exact: true }).count(), 0)
  await assert.rejects(call('get_credential_health'), /VAULT_LOCKED/)
  await page.getByPlaceholder('主密码', { exact: true }).fill(password)
  await page.getByRole('button', { name: '解锁', exact: true }).click()
  await page.getByRole('heading', { name: '全部条目', exact: true }).waitFor()
  assert.deepEqual((await item(env.id)).fields, expected)
  assert.equal((await call('list_item_history', { id: env.id })).length, 1)
  pass('locking clears the pending import, denies health reads and preserves previously saved values')

  const historical = await call('create_item', { item: { type: 'custom', title: 'History Original', username: 'old-user', password: 'fixture-history-old', notes: 'private old note',
    environment: 'testing', tags: ['old-tag'], fields: { TOKEN: 'fixture-history-token-old', REMOVED: '', SAME: 'fixture-unchanged', MULTI: 'first\nsecond' } } })
  const before = await item(historical.id)
  await call('update_item', { item: { ...before, title: 'History Current', password: 'fixture-history-new', notes: undefined, environment: 'production', tags: ['new-tag'],
    fields: { TOKEN: 'fixture-history-token-new', ADDED: '', SAME: 'fixture-unchanged', MULTI: 'first\nthird' } } })
  const saved = await item(historical.id)
  // A second version exercises unchanged content and switching back to a revealed version.
  await call('update_item', { item: saved })
  await page.getByRole('link', { name: '凭证健康', exact: true }).click()
  await page.getByRole('link', { name: '全部条目', exact: true }).click()
  await page.getByRole('button', { name: 'History Current', exact: true }).click()
  const currentBeforePreview = await item(historical.id)
  await modal().getByRole('button', { name: '历史版本', exact: true }).click()
  const historyPanel = modal().locator('.item-history')
  async function selectVersion(number) {
    await historyPanel.locator('.n-select').click()
    await page.locator('.n-base-select-option').filter({ hasText: `修改前版本 ${number}` }).click()
    await page.locator('.n-base-select-menu').waitFor({ state: 'hidden' })
    await historyPanel.getByText(/与当前保存内容对比/).waitFor()
  }
  const row = key => historyPanel.locator(`[data-field="${key}"]`)
  await selectVersion(1)
  assert.equal(await historyPanel.getByRole('checkbox', { name: '仅显示变化' }).isChecked(), true)
  assert.equal(await row('field:SAME').count(), 0)
  for (const [key, kind] of [['field:ADDED', '新增'], ['field:REMOVED', '删除'], ['field:TOKEN', '修改'], ['notes', '删除'], ['environment', '修改'], ['tags', '修改']]) {
    assert.equal(await row(key).locator('.n-tag').innerText(), kind)
  }
  assert.equal(await row('title').locator('pre').nth(0).innerText(), before.title)
  assert.equal(await row('title').locator('pre').nth(1).innerText(), saved.title)
  assert.ok(!(await historyPanel.innerText()).includes('fixture-history-'))
  await historyPanel.getByRole('button', { name: '历史密码显示', exact: true }).click()
  assert.deepEqual(await row('password').locator('pre').allTextContents(), ['fixture-history-old', 'fixture-history-new'])
  await historyPanel.getByRole('button', { name: '历史ADDED显示', exact: true }).click()
  assert.deepEqual(await row('field:ADDED').locator('pre').allTextContents(), ['（不存在）', '（空值）'])
  await historyPanel.getByRole('button', { name: '历史REMOVED显示', exact: true }).click()
  assert.deepEqual(await row('field:REMOVED').locator('pre').allTextContents(), ['（空值）', '（不存在）'])
  await historyPanel.getByRole('checkbox', { name: '仅显示变化' }).uncheck()
  assert.equal(await row('field:SAME').locator('.n-tag').innerText(), '未变化')
  assert.ok(!(await row('field:SAME').innerText()).includes('fixture-unchanged'))
  await selectVersion(2)
  await historyPanel.getByText('此版本与当前保存内容一致。', { exact: true }).waitFor()
  assert.ok(!(await historyPanel.innerText()).includes('fixture-history-new'))
  await selectVersion(1)
  assert.ok(!(await historyPanel.innerText()).includes('fixture-history-old'))
  await historyPanel.getByRole('checkbox', { name: '仅显示变化' }).check()
  await row('field:ADDED').scrollIntoViewIfNeeded()
  await page.screenshot({ path: resolve(output, 'upgrade-history-diff.png') })
  assert.deepEqual(await item(historical.id), currentBeforePreview)
  pass('history compares old to current values, labels additions/removals/changes, preserves empty fields and resets reveals on version switches')

  await historyPanel.getByRole('button', { name: '恢复此版本', exact: true }).click()
  await page.locator('.n-dialog').getByRole('button', { name: '取消', exact: true }).click()
  assert.deepEqual((await item(historical.id)).fields, saved.fields)
  await historyPanel.getByRole('button', { name: '恢复此版本', exact: true }).click()
  await page.getByRole('button', { name: '确认恢复版本', exact: true }).click()
  await modal().waitFor({ state: 'hidden' })
  await page.locator('.n-dialog').waitFor({ state: 'hidden' })
  const restored = await item(historical.id)
  assert.equal(restored.title, before.title)
  assert.equal(restored.password, before.password)
  assert.deepEqual(restored.fields, before.fields)
  const restoredHistory = await call('list_item_history', { id: historical.id })
  assert.equal(restoredHistory.length, 3)
  assert.deepEqual((await call('get_item_history', { id: historical.id, historyId: restoredHistory[0].id })).fields, saved.fields)
  pass('history comparison keeps cancellation read-only and restores the selected version while retaining the replaced content')

  await page.getByRole('button', { name: 'History Original', exact: true }).click()
  await modal().getByRole('button', { name: '历史版本', exact: true }).click()
  await selectVersion(3)
  await historyPanel.getByRole('button', { name: '历史密码显示', exact: true }).click()
  await call('lock_vault')
  await page.getByRole('heading', { name: '解锁保险库' }).waitFor()
  assert.equal(await page.locator('.history-field').count(), 0)
  assert.ok(!(await page.locator('body').innerText()).includes('fixture-history'))
  pass('locking destroys revealed history comparisons')
  assert.deepEqual(errors, [])
} catch (error) {
  console.error(error)
  if (page) await page.screenshot({ path: resolve(output, 'upgrade-workflows-failure.png') }).catch(() => {})
  process.exitCode = 1
} finally {
  await mkdir(output, { recursive: true })
  await writeFile(resolve(output, 'upgrade-workflows-report.json'), JSON.stringify({ passed: report, errors }, null, 2))
  if (application) await application.evaluate(({ app }) => app.exit(0)).catch(() => {})
}
