import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { writeFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'

const execute = promisify(execFile)

// Select synthetic files in the native dialog owned by this test application only.
async function chooseFile(pid, title, path) {
  const ps = value => `'${String(value).replace(/'/g, "''")}'`
  const script = `
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$dialogCondition = [Windows.Automation.AndCondition]::new(
  [Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::ProcessIdProperty, ${pid}),
  [Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::NameProperty, ${ps(title)}))
$deadline = [DateTime]::UtcNow.AddSeconds(20)
do {
  $windows = [Windows.Automation.AutomationElement]::RootElement.FindAll([Windows.Automation.TreeScope]::Children, [Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::ProcessIdProperty, ${pid}))
  $dialog = $null
  foreach ($window in $windows) {
    $dialog = $window.FindFirst([Windows.Automation.TreeScope]::Subtree, $dialogCondition)
    if ($dialog) { break }
  }
  if (-not $dialog) { Start-Sleep -Milliseconds 150 }
} until ($dialog -or [DateTime]::UtcNow -gt $deadline)
if (-not $dialog) { throw 'Test file dialog not found' }
do {
  $filename = $dialog.FindFirst([Windows.Automation.TreeScope]::Descendants, [Windows.Automation.AndCondition]::new([Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::AutomationIdProperty, '1148'), [Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::ControlTypeProperty, [Windows.Automation.ControlType]::Edit)))
  if (-not $filename) { Start-Sleep -Milliseconds 150 }
} until ($filename -or [DateTime]::UtcNow -gt $deadline)
if (-not $filename) { throw 'File name input not found' }
$filename.GetCurrentPattern([Windows.Automation.ValuePattern]::Pattern).SetValue(${ps(path)})
$buttons = $dialog.FindAll([Windows.Automation.TreeScope]::Descendants, [Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::ControlTypeProperty, [Windows.Automation.ControlType]::Button))
$open = $buttons | Where-Object { $_.Current.Name -match '^打开|^Open' } | Select-Object -First 1
if (-not $open) { throw 'Open button not found' }
$open.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern).Invoke()
`
  await execute('pwsh.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 30_000 })
}

export async function verifyUpgradeWorkflow({ page, call, run, pid, password, automaticDirectory, clipboard }) {
  const timings = {}
  const section = name => page.getByRole('link', { name, exact: true }).click()
  const group = name => page.getByRole('navigation', { name: '设置分组' }).getByRole('button', { name, exact: true }).click()
  const dialog = () => page.getByRole('dialog')
  async function refresh() {
    await section('全部条目')
    await page.getByRole('button', { name: '刷新凭证列表' }).click()
    await page.locator('.n-spin-body:visible').waitFor({ state: 'hidden' })
  }
  await section('设置')
  assert.equal(await page.getByText('剪贴板清除时间', { exact: true }).count(), 0)
  await group('安全')
  assert.equal(await page.getByPlaceholder('新主密码（至少 8 个字符）').count(), 0)
  await page.getByRole('button', { name: '修改主密码', exact: true }).click()
  await page.getByLabel('新主密码', { exact: true }).waitFor()
  await group('通用')
  await page.screenshot({ path: resolve(run, 'settings-grouped.png') })

  await refresh()
  await page.getByRole('button', { name: '新建', exact: true }).click()
  await dialog().getByRole('button', { name: '保存', exact: true }).click()
  await page.getByText('请输入凭证名称。', { exact: true }).waitFor()
  assert.equal(await page.getByRole('textbox', { name: '凭证名称', exact: true }).evaluate(el => document.activeElement === el), true)
  await page.getByRole('textbox', { name: '凭证名称', exact: true }).fill('Keyboard save fixture')
  await page.getByPlaceholder('密码', { exact: true }).fill('fixture-long-unique-password-2026')
  assert.equal(await page.getByPlaceholder('备注', { exact: true }).count(), 0)
  await page.getByRole('button', { name: '展开备注、自定义字段与标签' }).click()
  await page.getByPlaceholder('备注', { exact: true }).fill('Keep this note when collapsed')
  await page.getByRole('button', { name: '收起备注、自定义字段与标签' }).click()
  const saveStart = Date.now()
  await page.keyboard.press('Control+s')
  await dialog().waitFor({ state: 'hidden' })
  timings.saveToCloseMs = Date.now() - saveStart
  const saved = (await call('list_items')).find(item => item.title === 'Keyboard save fixture')
  assert.equal((await call('get_item', { id: saved.id, recordAccess: false })).notes, 'Keep this note when collapsed')

  const titles = await page.locator('.item-title').allTextContents()
  const opener = page.locator('.item-title').filter({ hasText: titles[1] }).first()
  await opener.click()
  await dialog().getByRole('button', { name: '下一条', exact: true }).click()
  await dialog().getByRole('heading', { name: titles[2], exact: true }).waitFor()
  await dialog().getByRole('button', { name: '上一条', exact: true }).click()
  await dialog().getByRole('heading', { name: titles[1], exact: true }).waitFor()
  await dialog().getByRole('button', { name: '关闭', exact: true }).click()
  assert.equal(await opener.evaluate(el => document.activeElement === el), true)

  const weak = await call('create_item', { item: { type: 'login', title: 'Health repair fixture', password: 'short' } })
  await refresh()
  await section('凭证健康')
  await page.getByRole('button', { name: '处理凭证Health repair fixture' }).click()
  await page.getByPlaceholder('密码', { exact: true }).fill('repaired-unique-long-password-2026')
  await page.keyboard.press('Control+s')
  await dialog().waitFor({ state: 'hidden' })
  await page.getByRole('button', { name: '处理凭证Health repair fixture' }).waitFor({ state: 'hidden' })
  assert.match(page.url(), /health/)
  assert.equal((await call('get_credential_health')).some(entry => entry.id === weak.id), false)

  await section('密码生成器')
  await page.getByLabel('密码长度', { exact: true }).fill('29')
  await page.getByLabel('密码长度', { exact: true }).press('Tab')
  await page.waitForFunction(() => document.querySelector('.password-output textarea')?.value.length === 29)
  await page.waitForFunction(async () => (await window.__TAURI_INTERNALS__.invoke('vault_command', { command: 'get_settings', args: null })).passwordGenerator.length === 29)
  await section('全部条目')
  await section('密码生成器')
  assert.equal(await page.getByLabel('密码长度', { exact: true }).inputValue(), '29')

  await section('设置')
  await group('备份与数据')
  const before = await call('list_items')
  const backupFiles = (await readdir(automaticDirectory)).filter(name => name.endsWith('.jvault'))
  await page.getByRole('button', { name: '验证备份', exact: true }).click()
  await Promise.all([
    chooseFile(pid, '选择加密备份', resolve(automaticDirectory, backupFiles[0])),
    dialog().getByRole('button', { name: '选择备份文件', exact: true }).click(),
  ])
  await page.getByLabel('备份主密码', { exact: true }).fill(password)
  await dialog().getByRole('button', { name: '验证并预览' }).click()
  await page.getByText('备份已验证，尚未替换当前保险库。', { exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: '确认替换并恢复' }).count(), 0)
  await page.screenshot({ path: resolve(run, 'backup-verified.png') })
  await page.getByRole('button', { name: '完成验证' }).click()
  assert.deepEqual(await call('list_items'), before)

  const csvPath = resolve(run, 'external-fixture.csv')
  await writeFile(csvPath, '名称,账号,密码,网址\nMapped fixture,mapped-user,synthetic-secret-only,https://example.test\nMapped fixture,mapped-user,synthetic-secret-only,https://example.test\n')
  await Promise.all([
    chooseFile(pid, '导入 JSON / CSV', csvPath),
    page.getByRole('button', { name: '导入 JSON / CSV', exact: true }).click(),
  ])
  await page.getByText('CSV 列映射', { exact: true }).waitFor()
  for (const [label, option] of [['名称', '1. 名称'], ['账号', '2. 账号'], ['密码', '3. 密码'], ['网址', '4. 网址']]) {
    const field = page.getByLabel(`映射${label}列`, { exact: true })
    await field.fill(option)
    await field.press('ArrowDown')
    await field.press('Enter')
  }
  await page.getByRole('button', { name: '预览导入', exact: true }).click()
  await page.getByText(/有效 2 条 · 重复 1 条 · 错误 0 条/).waitFor()
  assert.equal((await dialog().innerText()).includes('synthetic-secret-only'), false)
  await page.screenshot({ path: resolve(run, 'csv-mapped-preview.png') })
  await page.getByRole('button', { name: '导入 1 条有效记录' }).click()
  await dialog().waitFor({ state: 'hidden' })
  assert.equal((await call('list_items')).filter(item => item.title === 'Mapped fixture').length, 1)

  await call('create_item', { item: { type: 'server', title: 'SSH command fixture', host: 'example.test', username: "o'brien", port: 2222, password: 'never-in-command' } })
  await call('create_item', { item: { type: 'database', title: 'Database action fixture', password: 'fixture-db-password', fields: { connectionString: 'postgresql://fixture-connection' } } })
  await call('create_item', { item: { type: 'api-key', title: 'Endpoint action fixture', fields: { apiKey: 'fixture-key', endpoint: 'https://example.test/api' } } })
  await call('create_item', { item: { type: 'custom', title: 'Custom field fixture', fields: { token: 'fixture-token' } } })
  await refresh()
  await page.getByRole('button', { name: '更多操作 SSH command fixture' }).click()
  await page.getByRole('menuitem', { name: '复制 SSH 连接命令', exact: true }).click()
  await page.getByText(/已复制 SSH 连接命令/).waitFor()
  assert.equal(clipboard(), "ssh -p 2222 -l 'o''brien' -- 'example.test'")
  await page.getByRole('button', { name: '更多操作 Database action fixture' }).click()
  await page.getByRole('menuitem', { name: '复制连接串', exact: true }).click()
  await page.getByText(/已复制连接串/).waitFor()
  assert.equal(clipboard(), 'postgresql://fixture-connection')
  assert.equal(await page.getByRole('button', { name: '打开 Endpoint action fixture', exact: true }).count(), 1)
  await page.getByRole('button', { name: 'Custom field fixture', exact: true }).click()
  await dialog().getByRole('button', { name: '编辑凭证', exact: true }).click()
  assert.equal(await page.getByLabel('字段名称', { exact: true }).inputValue(), 'token')
  await dialog().getByRole('button', { name: '取消', exact: true }).click()

  const searchStart = Date.now()
  await page.keyboard.press('Control+k')
  const search = page.getByRole('combobox', { name: '搜索凭证' })
  await search.waitFor()
  assert.equal(await search.evaluate(el => document.activeElement === el), true)
  timings.searchToInputMs = Date.now() - searchStart
  await search.fill('Keyboard save fixture')
  const copyStart = Date.now()
  await page.getByRole('button', { name: '复制密码并关闭', exact: true }).click()
  await page.getByText(/已复制密码/).waitFor()
  timings.copyToFeedbackMs = Date.now() - copyStart
  await dialog().waitFor({ state: 'hidden' })
  await writeFile(resolve(run, 'upgrade-timings.json'), JSON.stringify({ ...timings, boundary: 'Windows debug Tauri + WebView2, synthetic vault, includes Playwright input/IPC/wait overhead; one sample per operation' }, null, 2))
  return timings
}
