import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import electron from 'electron'
import { _electron } from 'playwright-core'
import { createVaultThroughUI } from './onboarding.mjs'

const output = resolve('output/playwright')
const data = resolve(output, `updates-${Date.now()}`)
await mkdir(data, { recursive: true })
const installed = process.env.JIAZI_INSTALLED_EXE
let application, page
const report = [], errors = []
const pass = message => { report.push(message); console.log('PASS ' + message) }
try {
  application = await _electron.launch({ executablePath: installed || electron, args: installed ? [`--user-data-dir=${data}`] : [resolve('tests/electron-launch.cjs')], env: { ...process.env, JIAZI_TEST_DATA: data } })
  page = await application.firstWindow()
  page.setDefaultTimeout(15000)
  page.on('pageerror', error => errors.push(error.message))
  await application.evaluate(({ net, shell }) => {
    globalThis.updateRequests = []
    globalThis.updateMode = 'new'
    globalThis.openedReleasePage = null
    net.fetch = async (url, options) => {
      globalThis.updateRequests.push({ url, credentials: options.credentials, redirect: options.redirect })
      if (globalThis.updateMode === 'offline') throw new Error('offline')
      if (globalThis.updateMode === 'limited') return new Response('{}', { status: 429 })
      return new Response(JSON.stringify({ tag_name: globalThis.updateMode === 'current' ? `v${globalThis.currentVersion}` : 'v999.0.0', draft: false, prerelease: false, body: '<script>window.releaseInjected = true</script>\nFixture release notes' }))
    }
    shell.openExternal = async url => { globalThis.openedReleasePage = url }
  })
  const version = await application.evaluate(({ app }) => { globalThis.currentVersion = app.getVersion(); return app.getVersion() })
  await createVaultThroughUI(page, 'update-ui-test-password')
  await page.getByRole('link', { name: '设置', exact: true }).click()
  const card = page.locator('.updates-card')
  await card.getByText(`v${version}`, { exact: true }).waitFor()
  assert.deepEqual(await application.evaluate(() => globalThis.updateRequests), [])
  await card.getByRole('button', { name: '检查更新', exact: true }).click()
  await card.getByText('发现新版本 v999.0.0', { exact: true }).waitFor()
  await card.locator('summary').click()
  assert.ok((await card.locator('pre').innerText()).includes('<script>'))
  assert.equal(await page.evaluate(() => window.releaseInjected), undefined)
  pass('settings shows app version; checking is manual and release notes render as plain text')

  await application.evaluate(() => { globalThis.updateMode = 'offline' })
  await card.getByRole('button', { name: '检查更新', exact: true }).click()
  await card.getByText(/暂时无法检查更新/).waitFor()
  assert.equal(await card.locator('details').count(), 0)
  await application.evaluate(() => { globalThis.updateMode = 'limited' })
  await card.getByRole('button', { name: '检查更新', exact: true }).click()
  await card.getByText(/检查过于频繁/).waitFor()
  await application.evaluate(() => { globalThis.updateMode = 'current' })
  await card.getByRole('button', { name: '检查更新', exact: true }).click()
  await card.getByText('当前已是最新版本。', { exact: true }).waitFor()
  pass('network errors and rate limits show actionable messages; retry recovers correctly')

  await card.getByRole('button', { name: '打开官方下载页', exact: true }).click()
  assert.equal(await application.evaluate(() => globalThis.openedReleasePage), 'https://github.com/Darkerhao/jiazi-vault/releases/latest')
  await page.evaluate(() => window.jiaziVault.invoke('open_release_page', { url: 'https://untrusted.invalid' }))
  assert.equal(await application.evaluate(() => globalThis.openedReleasePage), 'https://github.com/Darkerhao/jiazi-vault/releases/latest')
  assert.ok((await application.evaluate(() => globalThis.updateRequests)).every(request => request.credentials === 'omit' && request.redirect === 'error'))
  pass('external opening uses only the fixed official release page and ignores renderer-supplied URLs')
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 600))
  await card.scrollIntoViewIfNeeded()
  await page.screenshot({ path: resolve(output, 'app-update.png') })
  assert.deepEqual(errors, [])
} catch (error) {
  errors.push(String(error))
  await page?.screenshot({ path: resolve(output, 'app-update-failure.png') }).catch(() => {})
  throw error
} finally {
  await application?.close().catch(() => {})
  await writeFile(resolve(output, 'app-update-report.json'), JSON.stringify({ report, errors, data, boundaries: 'Real renderer and IPC; GitHub responses and external browser opening are stubbed.' }, null, 2))
}
