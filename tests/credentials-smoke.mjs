import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const { _electron } = await import(pathToFileURL(process.env.JIAZI_PLAYWRIGHT_MODULE).href)
const root = process.cwd(), output = resolve(root, 'output/playwright')
const data = resolve(output, `credentials-data-${Date.now()}`)
await mkdir(data, { recursive: true })
const report = [], errors = [], password = 'credentials-test-master-password'
let application, page, originalClipboard
const pass = (name) => { report.push(name); console.log('PASS ' + name) }
const call = (command, args) => page.evaluate(({ command, args }) => window.jiaziVault.invoke(command, args), { command, args })
const dialog = () => page.getByRole('dialog')
async function launch() {
  application = await _electron.launch({ executablePath: resolve(root, 'node_modules/electron/dist/electron.exe'), args: [resolve(root, 'tests/electron-launch.cjs')], cwd: root, env: { ...process.env, JIAZI_TEST_DATA: data } })
  page = await application.firstWindow()
  page.setDefaultTimeout(15_000)
  page.on('pageerror', (error) => errors.push(error.message))
  await page.getByRole('heading', { name: /创建保险库|解锁保险库/ }).waitFor()
}
async function section(name) { await page.getByRole('link', { name, exact: true }).click() }
async function select(placeholder, label) {
  await page.locator('.filters .n-select').filter({ hasText: placeholder }).click()
  await page.locator('.n-base-select-menu').getByText(label, { exact: true }).click()
}
async function save() {
  await dialog().getByRole('button', { name: '保存', exact: true }).click()
  await page.getByPlaceholder('凭证名称').waitFor({ state: 'hidden' })
}
async function copy(label, expected) {
  await dialog().getByRole('button', { name: `复制${label}`, exact: true }).click()
  await page.getByText('已复制到剪贴板', { exact: true }).first().waitFor()
  assert.equal(await application.evaluate(async ({ clipboard }) => clipboard.readText()), expected)
}
async function fullByTitle(title) {
  const item = (await call('list_items', {})).find((item) => item.title === title)
  assert.ok(item)
  // JSON preserves literal dictionary keys across Playwright's own result serializer.
  return JSON.parse(await page.evaluate(async (id) => JSON.stringify(await window.jiaziVault.invoke('get_item', { id, recordAccess: false })), item.id))
}
try {
  await launch()
  originalClipboard = await application.evaluate(async ({ clipboard }) => clipboard.readText())
  await page.getByPlaceholder('主密码', { exact: true }).fill(password)
  await page.getByPlaceholder('确认主密码').fill(password)
  await page.getByRole('button', { name: '创建保险库', exact: true }).click()
  await page.getByRole('heading', { name: '全部条目' }).waitFor()
  await page.getByRole('button', { name: '新建', exact: true }).click()
  await dialog().locator('.n-select').first().click()
  await page.locator('.n-base-select-menu').getByText('自定义', { exact: true }).click()
  await page.getByPlaceholder('凭证名称').fill('Custom Lifecycle')
  await dialog().getByRole('button', { name: '新增字段' }).click()
  assert.equal(await dialog().getByRole('button', { name: '保存', exact: true }).isDisabled(), true)
  await page.getByPlaceholder('字段名称', { exact: true }).fill(' token ')
  await dialog().locator('.custom-field textarea').first().fill('first line\nsecond line')
  await dialog().getByRole('button', { name: '新增字段' }).click()
  await page.getByPlaceholder('字段名称', { exact: true }).nth(1).fill('token')
  await page.getByText('字段名称不能重复，也不能与当前类型的内置字段重名。').waitFor()
  assert.equal(await dialog().getByRole('button', { name: '保存', exact: true }).isDisabled(), true)
  await page.getByPlaceholder('字段名称', { exact: true }).nth(1).fill('empty')
  await save()
  let custom = await fullByTitle('Custom Lifecycle')
  assert.deepEqual(custom.fields, { token: 'first line\nsecond line', empty: '' })
  assert.equal(custom.type, 'custom')
  pass('custom creation, empty/duplicate name blocking, trimmed names, multiline and empty values persist')

  await page.getByText('Custom Lifecycle', { exact: true }).click()
  assert.equal(await dialog().getByRole('textbox', { name: '字段值token', exact: true }).inputValue(), '••••••••')
  await copy('token', 'first line\nsecond line')
  await dialog().getByRole('button', { name: '显示token', exact: true }).click()
  assert.equal(await dialog().getByRole('textbox', { name: '字段值token', exact: true }).inputValue(), 'first line\nsecond line')
  await dialog().getByRole('textbox', { name: '字段值token', exact: true }).fill('edited first line\nsecond line')
  assert.equal(await dialog().getByRole('button', { name: '复制empty', exact: true }).isDisabled(), true)
  await page.getByPlaceholder('字段名称', { exact: true }).first().fill('renamed')
  await dialog().getByRole('button', { name: '删除字段empty', exact: true }).click()
  await dialog().getByRole('button', { name: '新增字段' }).click()
  await page.getByPlaceholder('字段名称', { exact: true }).nth(1).fill('__proto__')
  await page.getByRole('textbox', { name: '字段值__proto__', exact: true }).fill('literal-field')
  await save()
  custom = await fullByTitle('Custom Lifecycle')
  assert.deepEqual(Object.keys(custom.fields).sort(), ['__proto__', 'renamed'])
  assert.equal(custom.fields.renamed, 'edited first line\nsecond line')
  assert.equal(custom.fields.__proto__, 'literal-field')
  assert.ok(custom.lastAccessedAt)
  pass('rename/delete changes persist without old keys; literal object keys and clipboard usage work')

  const project = await call('create_project', { project: { name: 'Smoke Project' } })
  const fixtures = [
    { type: 'login', title: 'Login Copy', username: 'alice', url: 'https://example.test/path', password: 'login-secret' },
    { type: 'database', title: 'Database Copy', host: 'db.test', port: 5432, fields: { connectionString: 'postgres://user:secret@db.test:5432/app' } },
    { type: 'ssh', title: 'SSH Copy', fields: { privateKey: '-----BEGIN PRIVATE KEY-----\nline-two\n-----END PRIVATE KEY-----' } },
    { type: 'secure-note', title: 'Note Copy', notes: 'line one\nline two' },
    { type: 'custom', title: 'Imported Common', host: 'retained-host', password: 'retained-password', fields: { imported: 'retained-token' } },
  ]
  for (const item of fixtures) await call('create_item', { item: { ...item, projectId: project.id, environment: 'production', favorite: true } })
  await section('设置')
  await section('全部条目')
  for (const [title, copies] of [
    ['Login Copy', [['用户名', 'alice'], ['URL', 'https://example.test/path'], ['密码', 'login-secret']]],
    ['Database Copy', [['主机', 'db.test'], ['端口', '5432'], ['连接串', 'postgres://user:secret@db.test:5432/app']]],
    ['SSH Copy', [['私钥', fixtures[2].fields.privateKey]]],
    ['Note Copy', [['内容', 'line one\nline two']]],
    ['Imported Common', [['主机', 'retained-host'], ['密码', 'retained-password'], ['imported', 'retained-token']]],
  ]) {
    await page.getByText(title, { exact: true }).click()
    for (const [label, value] of copies) await copy(label, value)
    if (title === 'Database Copy') {
      await dialog().getByRole('button', { name: '新增字段' }).click()
      await page.getByPlaceholder('字段名称', { exact: true }).fill('connectionString')
      assert.equal(await dialog().getByRole('button', { name: '保存', exact: true }).isDisabled(), true)
    }
    await dialog().getByRole('button', { name: '取消', exact: true }).click()
  }
  pass('all input kinds copy exact values through real clipboard; built-in field collisions blocked')

  await section('分类')
  await page.getByRole('heading', { name: '分类', exact: true }).waitFor()
  await section('登录账号')
  await page.getByRole('heading', { name: '登录账号', exact: true }).waitFor()
  assert.equal(await page.locator('.item-title').count(), 1)
  await select('全部项目', 'Smoke Project')
  await select('全部环境', 'Production')
  await page.getByPlaceholder('搜索凭证…').fill('alice')
  assert.equal(await page.locator('.item-title').count(), 1)
  await page.getByPlaceholder('搜索凭证…').fill('no-match')
  await page.getByText('没有匹配的凭证').waitFor()
  await page.getByPlaceholder('搜索凭证…').fill('')
  await page.goBack()
  await page.goForward()
  await page.getByRole('heading', { name: 'Smoke Project', exact: true }).waitFor()
  await page.getByText('Login Copy', { exact: true }).waitFor()
  assert.ok(page.url().includes('type=login') && page.url().includes('environment=production'))
  await page.getByRole('button', { name: '新建', exact: true }).click()
  assert.equal(await dialog().locator('.n-select').first().innerText(), '登录账号')
  await dialog().getByRole('button', { name: '取消', exact: true }).click()
  pass('category entry, combined type/project/environment/query filters, history and creation defaults work')

  await page.keyboard.press('Control+k')
  await page.getByPlaceholder('搜索名称、项目、环境、账号…').fill('Login Copy')
  const result = page.getByRole('option', { name: /Login Copy/ })
  await result.waitFor()
  assert.ok((await result.innerText()).includes('登录账号'))
  assert.ok((await result.innerText()).includes('alice'))
  assert.ok((await result.innerText()).includes('Smoke Project'))
  assert.ok((await result.innerText()).includes('production'))
  assert.equal(await result.locator('svg').count(), 1)
  assert.equal((await result.innerText()).includes('login-secret'), false)
  await page.waitForFunction(() => !document.querySelector('.n-spin-body'))
  await page.locator('.n-message').last().waitFor({ state: 'hidden' })
  await page.screenshot({ path: resolve(output, 'credentials-search.png') })
  await page.keyboard.press('Escape')
  await section('收藏夹')
  await select('全部类型', 'SSH')
  await page.getByText('SSH Copy', { exact: true }).waitFor()
  assert.equal(await page.locator('.item-title').count(), 1)
  pass('quick results show icon/title/project/environment/type plus account without exposing secrets; favorites support type filtering')

  await section('全部条目')
  await page.getByText('Custom Lifecycle', { exact: true }).click()
  await page.screenshot({ path: resolve(output, 'credentials-custom.png') })
  while (await dialog().getByRole('button', { name: /^删除字段/ }).count()) await dialog().getByRole('button', { name: /^删除字段/ }).first().click()
  await save()
  assert.equal((await fullByTitle('Custom Lifecycle')).fields, undefined)
  await application.close()
  await launch()
  await page.getByPlaceholder('主密码', { exact: true }).fill(password)
  await page.getByRole('button', { name: '解锁', exact: true }).click()
  await page.getByText('Custom Lifecycle', { exact: true }).waitFor()
  assert.equal((await fullByTitle('Custom Lifecycle')).fields, undefined)
  assert.equal((await fullByTitle('Imported Common')).host, 'retained-host')
  await page.waitForFunction(() => !document.querySelector('.n-spin-body'))
  await page.screenshot({ path: resolve(output, 'credentials-list.png') })
  assert.deepEqual(errors, [])
  pass('deleting all custom fields survives restart; imported common values preserved; renderer has no errors')
} catch (error) {
  errors.push(String(error))
  await page?.screenshot({ path: resolve(output, 'credentials-failure.png') }).catch(() => {})
  throw error
} finally {
  if (application) {
    await call('lock_vault').catch(() => {})
    if (originalClipboard !== undefined) await application.evaluate(async ({ clipboard }, text) => clipboard.writeText(text), originalClipboard).catch(() => {})
    await application.close().catch(() => {})
  }
  await writeFile(resolve(output, 'credentials-smoke-report.json'), JSON.stringify({ report, errors, data, boundaries: 'Isolated production Electron/SQLite/clipboard. Fixtures seeded over real IPC; form, navigation, copy and restart exercised through the real UI. No OS lock/suspend/physical global shortcut checks.' }, null, 2))
}
