import assert from 'node:assert/strict'
import { spawn, spawnSync, execFileSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { once } from 'node:events'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { resolve, dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { chromium } from 'playwright-core'
import { createVaultThroughUI } from './onboarding.mjs'

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

  await page.getByRole('button', { name: '新建', exact: true }).click()
  await page.getByPlaceholder('凭证名称').fill('Native UI credential')
  await page.getByRole('dialog').getByRole('button', { name: '保存', exact: true }).click()
  await page.getByText('Native UI credential', { exact: true }).waitFor()
  const created = (await call('list_items')).find(item => item.title === 'Native UI credential')
  assert.ok(created)
  pass('existing Vue form saves through native Tauri IPC into SQLite')

  const project = await call('create_project', { project: { name: 'Native project', color: '#C96100' } })
  const sensitive = await call('create_item', { item: { type: 'login', title: 'Native secret', username: 'fixture-user', password: 'fixture-secret-for-native', notes: 'private fixture', projectId: project.id, favorite: true } })
  assert.equal('password' in sensitive, false)
  await call('update_item', { item: { ...await call('get_item', { id: sensitive.id, recordAccess: false }), password: 'changed-native-secret' } })
  const history = await call('list_item_history', { id: sensitive.id })
  assert.equal((await call('get_item_history', { id: sensitive.id, historyId: history[0].id })).password, 'fixture-secret-for-native')
  assert.ok(Array.isArray(await call('get_credential_health')))
  await refresh()
  await page.getByText('Native secret', { exact: true }).waitFor()
  pass('project, encrypted credentials, summaries, health and history work through real native IPC')

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
    if (current === '' || current === 'keystill-fixture-clipboard') execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Add-Type -AssemblyName System.Windows.Forms; [Console]::InputEncoding = [Text.Encoding]::UTF8; $value = [Console]::In.ReadToEnd(); if ($value.Length -eq 0) { [Windows.Forms.Clipboard]::Clear() } else { [Windows.Forms.Clipboard]::SetText($value) }'], { input: previousClipboard, encoding: 'utf8', windowsHide: true, stdio: ['pipe', 'ignore', 'ignore'] })
  }

  await section('全部条目')
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
  await stop()
  await launch(data)
  await unlock(password)
  await page.getByRole('heading', { name: '全部条目', exact: true }).waitFor()
  assert.equal((await call('get_item', { id: sensitive.id, recordAccess: false })).password, 'changed-native-secret')
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
