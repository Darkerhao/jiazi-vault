import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import electron from 'electron'
import { _electron } from 'playwright-core'
import { createVaultThroughUI } from './onboarding.mjs'

const output = resolve('output/playwright')
const data = resolve(output, `updates-${Date.now()}`)
await mkdir(data, { recursive: true })
const installed = process.env.JIAZI_INSTALLED_EXE
const payload = Buffer.alloc(2 * 1024 * 1024, 42)
const checksum = createHash('sha512').update(payload).digest('base64')
let notes = 'v0.1.13 → v0.1.14\n\n更新内容（2 条提交）：\n\n- feat(desktop): 添加启动与窗口设置功能 (ec04d82)\n\n  支持开机自启、静默启动和关闭后最小化到托盘。\n\n- chore(release): v0.1.14 (1f2b6f9)'
let mode = 'new', recentMode = 'notes', version, finishDownload
const recentEntries = [
  { tag_name: 'v0.1.18', draft: false, prerelease: false, published_at: '2026-10-21T08:00:00Z', body: '- 新增：独立关于页面与版本信息。\n- 改进：凭证的备份与恢复流程。\n\n  保留多行说明。' },
  { tag_name: 'v0.1.17', draft: false, prerelease: false, published_at: '2026-10-18T08:00:00Z', body: '- 修复：窗口关闭时确认未保存内容。\n- 改进：更新安装流程。' },
  { tag_name: 'v0.1.16', draft: false, prerelease: false, published_at: '2026-10-15T08:00:00Z', body: '- 新增：启动与窗口设置。\n<script>window.recentInjected = true</script>' },
  { tag_name: 'v0.2.0-beta', draft: false, prerelease: true, body: 'preview hidden' },
]
const requests = []
const server = createServer((request, response) => {
  requests.push(request.url)
  if (request.url === '/releases') {
    if (recentMode === 'offline') { response.writeHead(503).end(); return }
    response.setHeader('Content-Type', 'application/json')
    response.end(JSON.stringify(recentMode === 'empty' ? [] : recentEntries))
    return
  }
  if (mode === 'offline' || mode === 'limited') { response.writeHead(mode === 'offline' ? 503 : 429).end(); return }
  if (request.url.startsWith('/latest.yml')) {
    response.end(JSON.stringify({ version: mode === 'current' ? version : '999.0.0', releaseDate: new Date().toISOString(), releaseNotes: notes,
      files: [{ url: 'setup.exe', sha512: checksum, size: payload.length }] }))
  } else if (request.url.startsWith('/setup.exe')) {
    response.writeHead(200, { 'Content-Length': payload.length })
    if (mode === 'corrupt') response.end(Buffer.alloc(payload.length, 1))
    else {
      response.write(payload.subarray(0, payload.length / 2))
      setTimeout(() => response.write(payload.subarray(payload.length / 2, payload.length / 2 + 1)), 1200)
      finishDownload = () => response.end(payload.subarray(payload.length / 2 + 1))
    }
  } else response.writeHead(404).end()
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const feed = `http://127.0.0.1:${server.address().port}`
const config = resolve(data, 'updater.yml')
await writeFile(config, JSON.stringify({ provider: 'generic', url: feed, updaterCacheDirName: 'cache' }))
let application, page
const report = [], errors = []
const pass = message => { report.push(message); console.log('PASS ' + message) }
try {
  application = await _electron.launch({ executablePath: installed || electron, args: installed ? [`--user-data-dir=${data}`] : [resolve('tests/electron-launch.cjs')], env: { ...process.env, JIAZI_TEST_DATA: data, JIAZI_TEST_UPDATE_CONFIG: config } })
  page = await application.firstWindow()
  page.setDefaultTimeout(15000)
  page.on('pageerror', error => errors.push(error.message))
  if (installed) {
    // The packaged app has already begun its normal startup check before Playwright attaches.
    await page.waitForFunction(() => !!window.jiaziVault)
    const deadline = Date.now() + 65000
    while ((await page.evaluate(() => window.jiaziVault.invoke('get_update_state'))).status === 'checking') {
      assert.ok(Date.now() < deadline, 'Initial packaged update check did not finish')
      await new Promise(resolve => setTimeout(resolve, 200))
    }
  }
  version = await application.evaluate(({ app, shell, net }, { feed, config, data, installed }) => {
    const requireFromApp = process.getBuiltinModule('module').createRequire(app.getAppPath() + '/package.json')
    const { autoUpdater } = requireFromApp('electron-updater')
    autoUpdater.setFeedURL({ provider: 'generic', url: feed })
    autoUpdater.updateConfigPath = config
    autoUpdater.disableDifferentialDownload = true
    autoUpdater.logger = null
    Object.defineProperty(autoUpdater.app, 'baseCachePath', { value: data })
    globalThis.installRequests = []
    autoUpdater.quitAndInstall = (...args) => { globalThis.installRequests.push(args) }
    globalThis.openedAppLinks = []
    shell.openExternal = async url => { globalThis.openedAppLinks.push(url) }
    if (installed) {
      const fetch = net.fetch
      net.fetch = (url, options) => String(url).startsWith('https://api.github.com/repos/Darkerhao/jiazi-vault/releases')
        ? fetch(`${feed}/releases`, options) : fetch(url, options)
    }
    return app.getVersion()
  }, { feed, config, data, installed: !!installed })
  if (!installed) assert.equal(version, JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version)
  else {
    const checked = await page.evaluate(() => window.jiaziVault.invoke('check_for_updates'))
    assert.equal(checked.status, 'available', JSON.stringify(checked))
  }
  await createVaultThroughUI(page, 'update-ui-test-password')
  const dot = page.getByRole('img', { name: '有新版本可更新', exact: true })
  await dot.waitFor()
  assert.equal(requests.some(url => url.startsWith('/latest.yml')), true)
  assert.equal(requests.some(url => url.startsWith('/setup.exe')), false)
  assert.deepEqual(await application.evaluate(() => globalThis.installRequests), [])
  pass(`${installed ? 'packaged app' : 'startup'} detects a new version and shows a global red dot without downloading or installing`)
  await page.getByRole('link', { name: '设置', exact: true }).click()
  await page.getByRole('heading', { name: '设置', exact: true }).waitFor()
  assert.equal(await page.locator('.updates-card').count(), 0)
  await page.getByRole('link', { name: '关于', exact: true }).click()
  await page.getByRole('heading', { name: '关于', exact: true }).waitFor()
  assert.match(page.url(), /#\/about$/)
  await page.getByRole('link', { name: '关于', exact: true }).locator('xpath=ancestor::*[contains(@class,"n-menu-item-content--selected")]').waitFor()
  const card = page.locator('.updates-card')
  await page.getByText(`v${version}`, { exact: true }).waitFor()
  await card.getByText('检测到新版本：v999.0.0', { exact: true }).waitFor()
  await card.getByRole('button', { name: '更新到 v999.0.0', exact: true }).waitFor()
  assert.equal(await dot.count(), 1)
  const appInfo = await page.evaluate(() => window.jiaziVault.invoke('get_app_info'))
  const expectedInfo = await application.evaluate(({ app }) => ({
    version: app.getVersion(), platform: process.platform, arch: process.arch,
    systemVersion: process.getSystemVersion(), electronVersion: process.versions.electron,
    chromiumVersion: process.versions.chrome, nodeVersion: process.versions.node,
  }))
  assert.deepEqual(appInfo, expectedInfo)
  await page.getByRole('button', { name: '复制诊断信息', exact: true }).click()
  await page.getByText('已复制到剪贴板', { exact: true }).waitFor()
  const platform = { win32: 'Windows', darwin: 'macOS', linux: 'Linux' }[appInfo.platform] ?? appInfo.platform
  assert.equal(await application.evaluate(({ clipboard }) => clipboard.readText()), [
    `应用版本：Keystill ${appInfo.version}`, `操作系统：${platform} ${appInfo.systemVersion}`,
    `系统架构：${appInfo.arch}`, `Electron：${appInfo.electronVersion}`,
    `Chromium：${appInfo.chromiumVersion}`, `Node.js：${appInfo.nodeVersion}`,
  ].join('\n'))
  await page.getByText('查看运行环境', { exact: true }).click()
  await page.locator('.environment dd').filter({ hasText: `Keystill ${version}` }).waitFor()
  await page.getByText('查看运行环境', { exact: true }).click()
  for (const name of ['使用文档', '项目主页', '问题反馈']) await page.getByRole('button', { name, exact: true }).click()
  assert.deepEqual(await application.evaluate(() => globalThis.openedAppLinks), [
    'https://github.com/Darkerhao/jiazi-vault#readme',
    'https://github.com/Darkerhao/jiazi-vault',
    'https://github.com/Darkerhao/jiazi-vault/issues/new',
  ])
  for (const target of ['https://untrusted.invalid', '__proto__', 'constructor', ['project'], null]) {
    await assert.rejects(page.evaluate(target => window.jiaziVault.invoke('open_app_link', { target }), target), /INVALID_DATA/)
  }
  assert.equal(await application.evaluate(() => globalThis.openedAppLinks.length), 3)
  await page.getByRole('button', { name: '查看安全与备份设置', exact: true }).click()
  await page.getByRole('heading', { name: '设置', exact: true }).waitFor()
  await page.getByRole('link', { name: '关于', exact: true }).click()
  pass('About is a selected independent menu; settings no longer embeds updates; diagnostics and fixed help links work through real IPC')

  recentMode = 'offline'
  await card.getByRole('button', { name: '近期更新', exact: true }).click()
  const recentDialog = page.getByRole('dialog', { name: '近期更新', exact: true })
  await recentDialog.getByRole('alert').filter({ hasText: '无法加载近期更新，请检查网络后重试。' }).waitFor()
  recentMode = 'notes'
  await recentDialog.getByRole('button', { name: '重试', exact: true }).click()
  await recentDialog.getByRole('heading', { name: 'v0.1.18', exact: true }).waitFor()
  assert.equal(await recentDialog.evaluate(el => el.getBoundingClientRect().width <= 720), true)
  assert.equal(await recentDialog.locator('.release-entry').count(), 3)
  assert.equal(await recentDialog.locator('pre').first().innerText(), recentEntries[0].body)
  assert.ok((await recentDialog.locator('pre').last().innerText()).includes('<script>'))
  assert.equal(await page.evaluate(() => window.recentInjected), undefined)
  recentEntries[2].body = '- 新增：启动与窗口设置。\n- 改进：快捷搜索体验。'
  await recentDialog.getByRole('button', { name: '查看 v0.1.18 详情', exact: true }).click()
  assert.equal(await application.evaluate(() => globalThis.openedAppLinks.at(-1)), 'https://github.com/Darkerhao/jiazi-vault/releases/tag/v0.1.18')
  await recentDialog.getByRole('button', { name: '查看完整更新内容', exact: true }).click()
  assert.equal(await application.evaluate(() => globalThis.openedAppLinks.at(-1)), 'https://github.com/Darkerhao/jiazi-vault/releases')
  for (const tag of ['../issues', 'https://untrusted.invalid', '<script>', null]) {
    await assert.rejects(page.evaluate(tag => window.jiaziVault.invoke('open_app_link', { target: 'release', tag }), tag), /INVALID_DATA/)
  }
  await recentDialog.getByRole('button', { name: '知道了', exact: true }).click()
  await recentDialog.waitFor({ state: 'hidden' })
  await dot.waitFor()
  recentMode = 'empty'
  await card.getByRole('button', { name: '近期更新', exact: true }).click()
  await recentDialog.getByText('暂未发布正式版本。', { exact: true }).waitFor()
  await page.keyboard.press('Escape')
  await recentDialog.waitFor({ state: 'hidden' })
  recentMode = 'notes'
  pass('recent release dialog handles retry, empty history, complete notes, safe details links and closing without clearing the update dot')

  const preferences = await page.evaluate(() => window.jiaziVault.invoke('get_settings'))
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1366, 1040))
  await page.setViewportSize({ width: 1366, height: 1000 })
  for (const themeMode of ['light', 'dark']) {
    await page.evaluate(settings => window.jiaziVault.invoke('update_settings', { settings }), { ...preferences, themeMode })
    await page.reload()
    await page.getByPlaceholder('主密码', { exact: true }).fill('update-ui-test-password')
    await page.getByRole('button', { name: '解锁', exact: true }).click()
    await page.getByRole('link', { name: '关于', exact: true }).click()
    await page.getByText(`v${version}`, { exact: true }).waitFor()
    await page.screenshot({ path: resolve(output, `about-${themeMode}.png`), fullPage: true, animations: 'disabled' })
    await card.getByRole('button', { name: '近期更新', exact: true }).click()
    await recentDialog.getByRole('heading', { name: 'v0.1.18', exact: true }).waitFor()
    await page.screenshot({ path: resolve(output, `recent-updates-${themeMode}.png`), animations: 'disabled' })
    await recentDialog.getByRole('button', { name: '知道了', exact: true }).click()
    await recentDialog.waitFor({ state: 'hidden' })
  }
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 640))
  await page.setViewportSize({ width: 900, height: 600 })
  await page.locator('.n-layout-sider--collapsed').waitFor()
  await page.locator('.about-menu-icon .update-dot').waitFor()
  for (const section of await page.locator('.about-content .n-card').all()) {
    assert.equal(await section.evaluate(el => el.scrollWidth <= el.clientWidth && el.getBoundingClientRect().right <= window.innerWidth), true)
  }
  await page.screenshot({ path: resolve(output, 'about-compact.png'), fullPage: true, animations: 'disabled' })
  await page.getByRole('button', { name: '复制诊断信息', exact: true }).scrollIntoViewIfNeeded()
  await page.screenshot({ path: resolve(output, 'about-compact-help.png'), fullPage: true, animations: 'disabled' })
  await card.getByRole('button', { name: '近期更新', exact: true }).click()
  await recentDialog.getByRole('heading', { name: 'v0.1.18', exact: true }).waitFor()
  assert.equal(await recentDialog.evaluate(el => el.getBoundingClientRect().right <= innerWidth && el.getBoundingClientRect().bottom <= innerHeight), true)
  await page.screenshot({ path: resolve(output, 'recent-updates-compact.png'), animations: 'disabled' })
  await recentDialog.getByRole('button', { name: '知道了', exact: true }).click()
  await recentDialog.waitFor({ state: 'hidden' })
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1366, 900))
  await page.setViewportSize({ width: 1366, height: 860 })
  await page.locator('.n-layout-sider:not(.n-layout-sider--collapsed)').waitFor()
  pass('About renders in light and dark themes, survives lock/unlock on reload, and fits the compact desktop layout')
  assert.equal(requests.some(url => url.startsWith('/setup.exe')), false)
  mode = 'offline'
  await card.getByRole('button', { name: '重新检查', exact: true }).click()
  await card.getByText(/暂时无法检查更新/).waitFor()
  mode = 'limited'
  await dot.waitFor()
  await card.getByRole('button', { name: '重新检查', exact: true }).click()
  await card.getByText(/检查过于频繁/).waitFor()
  mode = 'current'
  await card.getByRole('button', { name: '重新检查', exact: true }).click()
  await card.getByText('当前已是最新版本。', { exact: true }).waitFor()
  assert.equal(requests.some(url => url.startsWith('/setup.exe')), false)
  await dot.waitFor({ state: 'hidden' })
  pass('real updater handles network errors, rate limits and retry; confirming current version clears the dot without downloading')

  await card.locator('summary').click()
  assert.equal(await card.locator('pre').innerText(), notes)
  await card.scrollIntoViewIfNeeded()
  await page.screenshot({ path: resolve(output, 'app-update-notes.png') })
  await card.locator('summary').click()
  pass('release notes show the version range, every commit, and multiline descriptions from update metadata')

  mode = 'corrupt'
  notes += '\n<script>window.releaseInjected = true</script>'
  await card.getByRole('button', { name: '检查更新', exact: true }).click()
  await card.getByRole('button', { name: '更新到 v999.0.0', exact: true }).click()
  await card.getByText(/安装包校验失败/).waitFor()
  assert.deepEqual(await application.evaluate(() => globalThis.installRequests), [])
  await card.locator('summary').click()
  assert.ok((await card.locator('pre').innerText()).includes('<script>'))
  assert.equal(await page.evaluate(() => window.releaseInjected), undefined)
  pass('real downloaded bytes fail SHA-512 verification before installation; release notes remain plain text')

  await card.getByRole('button', { name: '打开官方下载页', exact: true }).click()
  await page.evaluate(() => window.jiaziVault.invoke('open_app_link', { target: 'releases', url: 'https://untrusted.invalid' }))
  assert.equal(await application.evaluate(() => globalThis.openedAppLinks.at(-1)), 'https://github.com/Darkerhao/jiazi-vault/releases/latest')
  pass('external opening uses the fixed official release page')

  mode = 'new'
  await card.getByRole('button', { name: '重试更新', exact: true }).click()
  await card.getByText(/正在下载 v999.0.0/).waitFor()
  assert.equal(await card.getByRole('button', { name: /更新到 v999\.0\.0/ }).isDisabled(), true)
  await page.getByRole('link', { name: '全部条目', exact: true }).click()
  await page.getByRole('link', { name: '关于', exact: true }).click()
  await card.getByText(/正在下载 v999.0.0/).waitFor()
  await card.locator('[role="progressbar"][aria-valuenow="50"]').waitFor()
  await card.scrollIntoViewIfNeeded()
  await page.screenshot({ path: resolve(output, 'app-update-download.png') })
  await page.getByRole('link', { name: '全部条目', exact: true }).click()
  await page.keyboard.press('Control+n')
  await page.getByPlaceholder('凭证名称', { exact: true }).fill('更新期间的草稿')
  assert.equal(typeof finishDownload, 'function')
  finishDownload()
  await page.getByRole('button', { name: '继续编辑', exact: true }).waitFor()
  assert.deepEqual(await application.evaluate(() => globalThis.installRequests), [])
  await page.getByRole('button', { name: '继续编辑', exact: true }).click()
  await page.getByRole('button', { name: '放弃修改', exact: true }).waitFor({ state: 'hidden' })
  assert.equal(await page.getByPlaceholder('凭证名称', { exact: true }).inputValue(), '更新期间的草稿')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  await page.getByRole('link', { name: '关于', exact: true }).click()
  await card.getByRole('button', { name: '安装已下载的更新', exact: true }).waitFor()
  const requestCount = requests.length
  await card.getByRole('button', { name: '安装已下载的更新', exact: true }).click()
  await page.getByRole('heading', { name: '解锁保险库' }).waitFor()
  assert.deepEqual(await application.evaluate(() => globalThis.installRequests), [[false, false]])
  assert.equal(requests.length, requestCount)
  pass('download waits for draft confirmation; cancel preserves editing and saved drafts can install without redownloading')
  assert.deepEqual(errors, [])
} catch (error) {
  errors.push(String(error))
  await page?.screenshot({ path: resolve(output, 'app-update-failure.png') }).catch(() => {})
  throw error
} finally {
  finishDownload?.()
  await application?.close().catch(() => {})
  server.closeAllConnections()
  await new Promise(resolve => server.close(resolve))
  await writeFile(resolve(output, installed ? 'app-update-packaged-report.json' : 'app-update-report.json'), JSON.stringify({ report, errors, data, executablePath: installed || electron,
    boundaries: 'Real renderer, IPC, electron-updater, loopback HTTP downloads and SHA-512 verification; installer launch and external browser opening intercepted. GitHub and OS installation are separate checks.' }, null, 2))
}
