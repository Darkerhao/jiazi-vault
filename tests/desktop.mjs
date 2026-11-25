import assert from 'node:assert/strict'
import { spawn, spawnSync, execFileSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { once } from 'node:events'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { resolve, dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { chromium } from 'playwright-core'
import { createVaultThroughUI } from './onboarding.mjs'
import { verifyResponsiveLayout } from './responsive-layout.mjs'

if (process.platform !== 'win32') throw new Error('This native CDP acceptance runner targets Windows WebView2')
const root = process.cwd(), output = resolve('output/playwright')
const exe = resolve(process.env.KEYSTILL_TEST_EXE || 'src-tauri/target/debug/keystill.exe')
const run = resolve(output, `tauri-${Date.now()}`)
await mkdir(run, { recursive: true })
const report = [], errors = []
const password = 'desktop-fixture-master-2026'
let child, browser, page
let completed = false
let failure
const pass = name => { report.push(name); console.log('PASS ' + name) }
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))
async function automaticBackupCount(directory) {
  return (await readdir(directory)).filter(name => name.startsWith('auto-') && name.endsWith('.jvault')).length
}
async function port() {
  const server = createServer().listen(0, '127.0.0.1')
  await once(server, 'listening')
  const number = server.address().port
  await new Promise(resolve => server.close(resolve))
  return number
}
async function call(command, args) {
  return page.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke('vault_command', { command, args: args ?? null }), { command, args })
}
async function launch(data) {
  const debugPort = await port()
  let startupError = ''
  child = spawn(exe, [], { cwd: dirname(exe), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, KEYSTILL_DATA_DIR: data, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${debugPort}` } })
  child.stderr.on('data', chunk => { startupError += String(chunk); appendFileSync(resolve(run, 'native-runtime.log'), chunk) })
  child.on('error', error => { startupError += error.message })
  const deadline = Date.now() + 45_000
  for (;;) {
    if (child.exitCode !== null) throw new Error(`Native application exited: ${startupError}`)
    try { const response = await fetch(`http://127.0.0.1:${debugPort}/json/version`, { signal: AbortSignal.timeout(1500) }); if (response.ok) break } catch {}
    if (Date.now() >= deadline) throw new Error(`WebView2 CDP did not become available: ${startupError}`)
    await delay(250)
  }
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`)
  const pageDeadline = Date.now() + 20_000
  while (!page) {
    page = browser.contexts().flatMap(context => context.pages()).find(candidate => /tauri\.localhost|127\.0\.0\.1:1420/.test(candidate.url()))
    if (!page && Date.now() >= pageDeadline) throw new Error('Native application page was not found')
    if (!page) await delay(100)
  }
  page.setDefaultTimeout(20_000)
  await page.setViewportSize({ width: 1200, height: 760 })
  page.on('pageerror', error => errors.push(error.message))
  await page.getByRole('heading', { name: /欢迎使用 Keystill|解锁保险库/ }).waitFor()
  assert.equal(await call('health_check'), 'ok')
  assert.ok((await call('database_info')).path.startsWith(data), 'Desktop checks must use their isolated vault directory')
}
async function stop() {
  if (page) await call('lock_vault').catch(() => {})
  if (browser) await browser.close().catch(() => {})
  if (child?.pid && child.exitCode === null && child.signalCode === null) {
    const exiting = once(child, 'exit').catch(() => {})
    const result = spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, encoding: 'utf8' })
    if (result.status !== 0) {
      let alive = true
      try { process.kill(child.pid, 0) } catch (error) { if (error.code === 'ESRCH') alive = false; else throw error }
      if (alive) child.kill()
    }
    await Promise.race([exiting, delay(5000)])
  }
  browser = page = child = undefined
}
async function section(name) { await page.getByRole('link', { name, exact: true }).click() }
async function refresh() { await section('设置'); await section('全部条目') }
async function unlock(value) {
  await page.getByPlaceholder('主密码', { exact: true }).fill(value)
  await page.getByRole('button', { name: '解锁', exact: true }).click()
}
function clipboard() {
  return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '[Console]::OutputEncoding = [Text.Encoding]::UTF8; [Console]::Write((Get-Clipboard -Raw))'], { encoding: 'utf8', windowsHide: true })
}
function setClipboard(value) {
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Add-Type -AssemblyName System.Windows.Forms; [Console]::InputEncoding = [Text.Encoding]::UTF8; $value = [Console]::In.ReadToEnd(); if ($value.Length -eq 0) { [Windows.Forms.Clipboard]::Clear() } else { [Windows.Forms.Clipboard]::SetText($value) }'], { input: value, encoding: 'utf8', windowsHide: true, stdio: ['pipe', 'ignore', 'ignore'] })
}
function windowVisible() {
  const script = `Add-Type -TypeDefinition 'using System; using System.Text; using System.Runtime.InteropServices; public static class VaultWindowState { public delegate bool EnumProc(IntPtr h, IntPtr p); [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr p); [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid); [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h); [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n); public static bool Visible(uint target) { bool visible = false; EnumWindows((h, p) => { uint pid; GetWindowThreadProcessId(h, out pid); if (pid == target) { var s = new StringBuilder(256); GetWindowText(h, s, 256); if (s.ToString() == "Keystill") visible = IsWindowVisible(h); } return true; }, IntPtr.Zero); return visible; } }'; [Console]::Write([VaultWindowState]::Visible([uint32]${child.pid}))`
  return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', windowsHide: true }).trim() === 'True'
}
function postWindowMessage(message = 16, parameter = 0) {
  const script = `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class VaultWindow { [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l); }'; $p=Get-Process -Id ${child.pid}; if ($p.MainWindowHandle -eq 0) { throw 'Native window handle missing' }; [void][VaultWindow]::PostMessage($p.MainWindowHandle, ${message}, [IntPtr]${parameter}, [IntPtr]::Zero)`
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, stdio: 'pipe' })
}

try {
  const data = resolve(run, 'fresh')
  await launch(data)
  await createVaultThroughUI(page, password)
  pass('real Tauri WebView2 onboarding creates and unlocks a Rust-backed vault')
  const info = await call('get_app_info')
  assert.ok(info.tauriVersion.startsWith('2.'))
  assert.equal('electronVersion' in info, false)
  assert.ok((await call('database_info')).path.startsWith(data))
  pass('native runtime reports Tauri and uses only the isolated test data directory')

  const automaticDirectory = resolve(run, 'automatic-backups')
  await mkdir(automaticDirectory, { recursive: true })
  const databasePath = (await call('database_info')).path
  let testDatabase = new DatabaseSync(databasePath)
  testDatabase.prepare('INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)').run('automatic_backup', JSON.stringify({ directory: automaticDirectory }))
  testDatabase.close()
  await call('run_automatic_backup')
  assert.equal(await automaticBackupCount(automaticDirectory), 1)
  testDatabase = new DatabaseSync(databasePath)
  let automaticRecord = JSON.parse(testDatabase.prepare('SELECT value FROM settings WHERE key=?').get('automatic_backup_record').value)
  automaticRecord.at = Date.now() + 60_000
  testDatabase.prepare('UPDATE settings SET value=? WHERE key=?').run(JSON.stringify(automaticRecord), 'automatic_backup_record')
  testDatabase.close()

  await page.getByRole('button', { name: '新建', exact: true }).click()
  await page.getByPlaceholder('凭证名称').fill('Native UI credential')
  await page.getByRole('dialog').getByRole('button', { name: '保存', exact: true }).click()
  await page.getByText('Native UI credential', { exact: true }).waitFor()
  assert.equal(await automaticBackupCount(automaticDirectory), 1, 'saving a credential must not write an automatic backup synchronously')
  assert.equal((await call('get_backup_status')).hasChanges, true)
  testDatabase = new DatabaseSync(databasePath)
  automaticRecord = JSON.parse(testDatabase.prepare('SELECT value FROM settings WHERE key=?').get('automatic_backup_record').value)
  automaticRecord.at = Date.now() - 16 * 60 * 1000
  testDatabase.prepare('UPDATE settings SET value=? WHERE key=?').run(JSON.stringify(automaticRecord), 'automatic_backup_record')
  testDatabase.close()
  const backupDeadline = Date.now() + 65_000
  while (await automaticBackupCount(automaticDirectory) === 1 && Date.now() < backupDeadline) await delay(250)
  assert.equal(await automaticBackupCount(automaticDirectory), 2, 'the unlocked minute scheduler must back up a due revision')
  assert.equal((await call('get_backup_status')).hasChanges, false)
  pass('native save returns without a backup write and the minute scheduler backs up a due revision')
  const created = (await call('list_items')).find(item => item.title === 'Native UI credential')
  assert.ok(created)
  pass('existing Vue form saves through native Tauri IPC into SQLite')

  const project = await call('create_project', { project: { name: 'Native project', color: '#C96100' } })
  const sensitive = await call('create_item', { item: { type: 'login', title: 'Native secret', username: 'fixture-user', password: 'fixture-secret-for-native', notes: 'private fixture', url: 'https://example.com', projectId: project.id, favorite: true } })
  assert.equal('password' in sensitive, false)
  const apiItem = await call('create_item', { item: { type: 'api-key', title: 'Native API key', fields: { apiKey: 'fixture-api-key' } } })
  assert.ok(apiItem)
  await call('update_item', { item: { ...await call('get_item', { id: sensitive.id, recordAccess: false }), password: 'changed-native-secret' } })
  const history = await call('list_item_history', { id: sensitive.id })
  assert.equal((await call('get_item_history', { id: sensitive.id, historyId: history[0].id })).password, 'fixture-secret-for-native')
  assert.ok(Array.isArray(await call('get_credential_health')))
  await refresh()
  await page.getByText('Native secret', { exact: true }).waitFor()
  await page.getByText('Native API key', { exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: '复制密码 Native secret' }).isVisible(), true)
  assert.equal(await page.getByRole('button', { name: '复制 API Key Native API key' }).isVisible(), true)
  pass('project, encrypted credentials, summaries, health and history work through real native IPC')

  await page.getByRole('button', { name: '置顶凭证 Native secret' }).click()
  await page.getByRole('button', { name: '取消置顶 Native secret' }).waitFor()
  assert.equal((await call('list_items'))[0].id, sensitive.id)
  assert.equal((await page.locator('.item-list .item-title').allTextContents())[0], 'Native secret')
  await refresh()
  await page.getByRole('button', { name: '取消置顶 Native secret' }).waitFor()
  pass('pinning a credential persists and moves it to the top of the active list')

  await section('关于')
  await page.getByText('密钥有序，专注如常。', { exact: true }).waitFor()
  await page.getByText('查看运行环境', { exact: true }).click()
  await page.getByText('Tauri', { exact: true }).waitFor()
  await page.screenshot({ path: resolve(run, 'about.png'), fullPage: true })
  await page.getByRole('heading', { name: '关于', exact: true }).scrollIntoViewIfNeeded()
  await page.screenshot({ path: resolve(run, 'about-top.png') })
  await section('设置')
  await page.getByRole('heading', { name: 'Windows Hello', exact: true }).waitFor()
  pass('About and settings render with the Rust runtime and native biometric availability')

  const settings = await call('get_settings')
  await call('update_settings', { settings: { ...settings, clipboardClearTimeout: 5 } })
  const previousClipboard = clipboard()
  try {
    await call('copy_to_clipboard', { text: 'keystill-fixture-clipboard', itemId: sensitive.id })
    if (clipboard() !== 'keystill-fixture-clipboard') throw new Error('System clipboard did not receive the fixture')
    await delay(6500)
    if (clipboard() !== '') throw new Error('Owned clipboard did not clear after its timeout')
    pass('native clipboard copy and timed cleanup work on the actual Windows clipboard')
  } finally {
    const current = clipboard()
    if (current === '' || current === 'keystill-fixture-clipboard') setClipboard(previousClipboard)
  }

  await section('全部条目')
  assert.equal(await page.getByRole('button', { name: '打开 https://example.com' }).isVisible(), true)
  const previousQuickSearchClipboard = clipboard()
  try {
    await page.keyboard.press('Control+K')
    const quickSearch = page.getByPlaceholder(/搜索名称、项目、环境、账号/)
    await quickSearch.waitFor()
    assert.match(await page.locator('.result').first().innerText(), /Native secret/)
    await quickSearch.fill('Native secret')
    assert.equal(await page.locator('option[value="primary"]').textContent(), '密码')
    assert.equal(await page.getByRole('button', { name: '打开', exact: true }).isEnabled(), true)
    await page.keyboard.press('Enter')
    await page.getByText(/已复制密码，\d+ 秒后清除/).waitFor()
    await page.getByText('快捷搜索', { exact: true }).waitFor({ state: 'hidden' })
    assert.equal(clipboard(), 'changed-native-secret')
    pass('quick search Enter copies the default password and closes')
  } finally {
    setClipboard(previousQuickSearchClipboard)
  }
  await page.keyboard.press('Control+K')
  const detailSearch = page.getByPlaceholder(/搜索名称、项目、环境、账号/)
  await detailSearch.waitFor()
  await detailSearch.fill('Native secret')
  await page.keyboard.press('Control+Enter')
  await page.getByRole('dialog').getByText('凭证详情', { exact: true }).waitFor()
  await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click()
  pass('quick search Ctrl+Enter opens credential details')

  const previousApiClipboard = clipboard()
  try {
    const copied = await call('copy_item', { id: apiItem.id })
    assert.equal(copied.copied, true)
    assert.equal(clipboard(), 'fixture-api-key')
  } finally {
    setClipboard(previousApiClipboard)
  }
  pass('native item copy reads the API key in Rust and writes the clipboard')

  for (const url of ['http://', 'javascript:alert(1)', 'file:///C:/secret', 'ftp://example.com']) {
    await assert.rejects(call('open_url', { url, itemId: sensitive.id }), /INVALID_URL/)
  }
  pass('credential URL opening rejects missing hosts and explicit non-http schemes')

  assert.equal(windowVisible(), true)
  await call('hide_window')
  await delay(500)
  assert.equal(windowVisible(), false)
  const second = spawn(exe, [], { cwd: dirname(exe), windowsHide: true, stdio: 'ignore', env: { ...process.env, KEYSTILL_DATA_DIR: data } })
  await Promise.race([once(second, 'exit'), delay(5000)])
  for (let attempt = 0; attempt < 20 && !windowVisible(); attempt++) await delay(250)
  assert.equal(windowVisible(), true)
  pass('native hide command hides the window and a second launch restores it')

  await page.getByRole('button', { name: '新建', exact: true }).click()
  await page.getByPlaceholder('凭证名称').fill('Unsaved native draft')
  postWindowMessage()
  await page.getByText('放弃未保存的修改？', { exact: true }).waitFor()
  await page.getByRole('button', { name: '继续编辑', exact: true }).click()
  assert.equal(await page.getByPlaceholder('凭证名称').inputValue(), 'Unsaved native draft')
  assert.equal((await call('get_vault_status')).unlocked, true)
  pass('actual Windows close request waits for the existing unsaved-form guard and cancellation preserves the draft')
  await page.getByRole('dialog').getByRole('button', { name: '保存', exact: true }).click()
  await page.getByText('Unsaved native draft', { exact: true }).waitFor()
  await call('lock_vault')
  await page.getByRole('heading', { name: '解锁保险库', exact: true }).waitFor()
  await assert.rejects(call('get_item', { id: sensitive.id }), /VAULT_LOCKED/)
  await unlock(password)
  await page.getByRole('heading', { name: '全部条目', exact: true }).waitFor()
  pass('locking clears sensitive views and native secret commands refuse reads until password authentication')

  await page.reload()
  await page.getByRole('heading', { name: '解锁保险库', exact: true }).waitFor()
  await unlock(password)
  await page.getByRole('heading', { name: '全部条目', exact: true }).waitFor()
  pass('reloading the native WebView invalidates the session before the new document can read credentials')
  for (const [message, parameter, label] of [[0x02B1, 7, 'session-lock'], [0x0218, 4, 'suspend']]) {
    postWindowMessage(message, parameter)
    await page.getByRole('heading', { name: '解锁保险库', exact: true }).waitFor()
    await assert.rejects(call('get_item', { id: sensitive.id }), /VAULT_LOCKED/)
    await unlock(password)
    await page.getByRole('heading', { name: '全部条目', exact: true }).waitFor()
    pass(`native Windows ${label} message locks the vault (simulated notification, not a physical system action)`)
  }

  await page.setViewportSize({ width: 900, height: 600 })
  await page.locator('.n-spin-body:visible').waitFor({ state: 'hidden' })
  await page.evaluate(async () => {
    await Promise.all(document.getAnimations().filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {})))
  })
  await page.screenshot({ path: resolve(run, 'vault-900x600.png'), fullPage: true })
  await call('create_item', { item: { type: 'login', title: '用于验证窄窗口长标题换行与操作按钮位置的示例凭证名称', username: 'long-account-name-for-responsive-layout-checks@example.keystill.test', password: 'responsive-fixture-only', projectId: project.id, environment: 'development', favorite: false, pinned: false } })
  await verifyResponsiveLayout(page, run)
  pass('all primary pages adapt to sidebar toggles and 900–1920px viewports without unused width or horizontal overflow')
  await stop()
  await launch(data)
  await unlock(password)
  await page.getByRole('heading', { name: '全部条目', exact: true }).waitFor()
  assert.equal((await call('get_item', { id: sensitive.id, recordAccess: false })).password, 'changed-native-secret')
  assert.equal((await call('get_item', { id: sensitive.id, recordAccess: false })).pinned, true)
  pass('restart preserves encrypted credentials and requires authentication again')
  await stop()

  const legacyData = resolve(run, 'legacy')
  await mkdir(legacyData, { recursive: true })
  const db = new DatabaseSync(resolve(legacyData, 'vault.db'))
  db.exec(await readFile(resolve('tests/fixtures/legacy-vault.sql'), 'utf8'))
  db.close()
  const legacy = JSON.parse(await readFile(resolve('tests/fixtures/legacy.json'), 'utf8'))
  await launch(legacyData)
  await unlock(legacy.password)
  await page.getByRole('heading', { name: '全部条目', exact: true }).waitFor()
  assert.equal((await call('get_item', { id: legacy.itemId, recordAccess: false })).password, legacy.expected.password)
  await page.getByText('Legacy account', { exact: true }).waitFor()
  pass('packaged native application opens the original Electron SQLite fixture through the real unlock UI')
  assert.deepEqual(errors, [])
  completed = true
} catch (error) {
  failure = error
  throw error
} finally {
  if (page) await page.screenshot({ path: resolve(run, 'final-state.png') }).catch(() => {})
  await stop().catch(error => { if (!failure) throw error; appendFileSync(resolve(run, 'cleanup-error.log'), String(error)) })
  await writeFile(resolve(output, 'tauri-desktop-report.json'), JSON.stringify({ executable: exe, completed, passed: report.length, report, errors, failure: failure?.message, evidence: run }, null, 2) + '\n')
}
