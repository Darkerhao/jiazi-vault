import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdir, writeFile } from 'node:fs/promises'
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
let mode = 'offline', version, finishDownload
const requests = []
const server = createServer((request, response) => {
  requests.push(request.url)
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
  application = await _electron.launch({ executablePath: installed || electron, args: installed ? [`--user-data-dir=${data}`] : [resolve('tests/electron-launch.cjs')], env: { ...process.env, JIAZI_TEST_DATA: data } })
  page = await application.firstWindow()
  page.setDefaultTimeout(15000)
  page.on('pageerror', error => errors.push(error.message))
  version = await application.evaluate(({ app, shell }, { feed, config, data }) => {
    const requireFromApp = process.getBuiltinModule('module').createRequire(app.getAppPath() + '/package.json')
    const { autoUpdater } = requireFromApp('electron-updater')
    autoUpdater.setFeedURL({ provider: 'generic', url: feed })
    autoUpdater.updateConfigPath = config
    autoUpdater.disableDifferentialDownload = true
    autoUpdater.logger = null
    Object.defineProperty(autoUpdater.app, 'baseCachePath', { value: data })
    globalThis.installRequests = []
    autoUpdater.quitAndInstall = (...args) => { globalThis.installRequests.push(args) }
    shell.openExternal = async url => { globalThis.openedReleasePage = url }
    return app.getVersion()
  }, { feed, config, data })
  await createVaultThroughUI(page, 'update-ui-test-password')
  await page.getByRole('link', { name: '设置', exact: true }).click()
  const card = page.locator('.updates-card')
  await card.getByText(`v${version}`, { exact: true }).waitFor()
  assert.deepEqual(requests, [])
  await card.getByRole('button', { name: '检查更新', exact: true }).click()
  await card.getByText(/暂时无法检查更新/).waitFor()
  mode = 'limited'
  await card.getByRole('button', { name: '重试更新', exact: true }).click()
  await card.getByText(/检查过于频繁/).waitFor()
  mode = 'current'
  await card.getByRole('button', { name: '重试更新', exact: true }).click()
  await card.getByText('当前已是最新版本。', { exact: true }).waitFor()
  assert.equal(requests.some(url => url.startsWith('/setup.exe')), false)
  pass('no startup requests; real updater handles network errors, rate limits, retry and current version without downloading')

  await card.locator('summary').click()
  assert.equal(await card.locator('pre').innerText(), notes)
  await card.scrollIntoViewIfNeeded()
  await page.screenshot({ path: resolve(output, 'app-update-notes.png') })
  await card.locator('summary').click()
  pass('release notes show the version range, every commit, and multiline descriptions from update metadata')

  mode = 'corrupt'
  notes += '\n<script>window.releaseInjected = true</script>'
  await card.getByRole('button', { name: '检查更新', exact: true }).click()
  await card.getByText(/安装包校验失败/).waitFor()
  assert.deepEqual(await application.evaluate(() => globalThis.installRequests), [])
  await card.locator('summary').click()
  assert.ok((await card.locator('pre').innerText()).includes('<script>'))
  assert.equal(await page.evaluate(() => window.releaseInjected), undefined)
  pass('real downloaded bytes fail SHA-512 verification before installation; release notes remain plain text')

  await card.getByRole('button', { name: '打开官方下载页', exact: true }).click()
  await page.evaluate(() => window.jiaziVault.invoke('open_release_page', { url: 'https://untrusted.invalid' }))
  assert.equal(await application.evaluate(() => globalThis.openedReleasePage), 'https://github.com/Darkerhao/jiazi-vault/releases/latest')
  pass('external opening uses the fixed official release page')

  mode = 'new'
  await card.getByRole('button', { name: '重试更新', exact: true }).click()
  await card.getByText(/正在下载 v999.0.0/).waitFor()
  assert.equal(await card.getByRole('button', { name: /检查更新/ }).isDisabled(), true)
  await page.getByRole('link', { name: '全部条目', exact: true }).click()
  await page.getByRole('link', { name: '设置', exact: true }).click()
  await card.getByText(/正在下载 v999.0.0/).waitFor()
  await card.locator('[role="progressbar"][aria-valuenow="50"]').waitFor()
  await card.scrollIntoViewIfNeeded()
  await page.screenshot({ path: resolve(output, 'app-update-download.png') })
  assert.equal(typeof finishDownload, 'function')
  finishDownload()
  await card.getByText('下载完成，正在退出应用并启动安装向导…', { exact: true }).waitFor()
  assert.deepEqual(await application.evaluate(() => globalThis.installRequests), [[false, false]])
  pass('progress survives settings remount; verified download automatically requests one interactive install')
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
  await writeFile(resolve(output, 'app-update-report.json'), JSON.stringify({ report, errors, data,
    boundaries: 'Real renderer, IPC, electron-updater, loopback HTTP downloads and SHA-512 verification; installer launch and external browser opening intercepted. GitHub and OS installation are separate checks.' }, null, 2))
}
