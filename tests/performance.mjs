import assert from 'node:assert/strict'
import { mkdir, stat, writeFile } from 'node:fs/promises'
import { cpus, platform, release, totalmem } from 'node:os'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { openDatabase } from '../dist-electron/database.js'
import { createItemStore } from '../dist-electron/item-store.js'
import { createProjectStore } from '../dist-electron/project-store.js'
import { createVaultCredential, clearKey } from '../dist-electron/vault-crypto.js'

const { _electron } = await import(pathToFileURL(process.env.JIAZI_PLAYWRIGHT_MODULE).href)
const root = process.cwd(), output = resolve(root, 'output/playwright')
const label = process.env.JIAZI_PERF_LABEL || 'current'
const data = resolve(output, `performance-${label}-${Date.now()}`)
const password = 'performance-test-master-password'
const count = 10_000, runs = Number(process.env.JIAZI_PERF_RUNS || 5)
const report = {
  label, count, runs, data, timestamp: new Date().toISOString(),
  machine: { platform: platform(), release: release(), cpu: cpus()[0].model, logicalCpus: cpus().length, memoryGiB: totalmem() / 1024 ** 3 },
  startupMs: [], search: [], errors: [],
  boundaries: 'Production renderer and real Electron/SQLite/crypto; fresh processes on this machine with OS disk cache retained; startup measures process creation to unlock form paint, excludes typing/password derivation. Search includes input dispatch, filtering, DOM update and two animation frames. Test launcher and Playwright instrumentation are present; no claim of installed-binary or OS-cache-cold timing.',
}
await mkdir(data, { recursive: true })
const state = openDatabase(data)
const credential = await createVaultCredential(password)
try {
  state.connection.prepare('INSERT INTO vault_metadata (key, value) VALUES (?, ?)').run('vault', JSON.stringify(credential.metadata))
  const projects = createProjectStore(state.connection)
  const items = createItemStore(state.connection, () => credential.masterKey)
  const types = ['login', 'password', 'server', 'database', 'api-key', 'ssh', 'secure-note', 'custom']
  const started = performance.now()
  state.connection.exec('BEGIN')
  const groups = Array.from({ length: 100 }, (_, index) => projects.create({ name: `Project ${String(index).padStart(3, '0')}` }))
  for (let index = 0; index < count; index++) {
    items.create({ type: types[index % types.length], title: `Credential ${String(index).padStart(5, '0')}`, username: `user-${index}`,
      host: `host-${index}.example.test`, url: `https://service-${index}.example.test`, projectId: groups[index % groups.length].id,
      environment: index % 2 ? 'production' : 'testing', tags: ['benchmark', `tag-${index % 10}`], favorite: index % 3 === 0,
      password: `private-sentinel-${index}`, fields: { token: `token-sentinel-${index}` }, notes: `note-sentinel-${index}` })
  }
  state.connection.exec('COMMIT')
  report.seedMs = performance.now() - started
  assert.equal(items.list().length, count)
  assert.equal(items.get(items.list()[0].id).password.startsWith('private-sentinel-'), true)
} finally { clearKey(credential.masterKey); state.connection.close() }
report.databaseBytes = (await stat(state.path)).size
console.log(`Seeded ${count} encrypted credentials in ${report.seedMs.toFixed(1)} ms`)

let application, page
const call = (command, args) => page.evaluate(({ command, args }) => window.jiaziVault.invoke(command, args), { command, args })
try {
  for (let run = 0; run < runs; run++) {
    application = await _electron.launch({ executablePath: resolve(root, 'node_modules/electron/dist/electron.exe'), args: [resolve(root, 'tests/performance-launch.cjs')], cwd: root, env: { ...process.env, JIAZI_TEST_DATA: data } })
    page = await application.firstWindow()
    page.setDefaultTimeout(30_000)
    page.on('pageerror', (error) => report.errors.push(error.message))
    await page.getByRole('heading', { name: '解锁保险库' }).waitFor()
    report.startupMs.push(await application.evaluate(() => globalThis.jiaziStartup))
    console.log(`Startup ${run + 1}: ${report.startupMs.at(-1).toFixed(1)} ms`)
    if (run === 0) {
      await page.getByPlaceholder('主密码', { exact: true }).fill(password)
      const started = performance.now()
      await page.getByRole('button', { name: '解锁', exact: true }).click()
      await page.locator('.item-title').first().waitFor()
      report.unlockAndListMs = performance.now() - started
      report.renderedRows = await page.locator('.item-title').count()
      console.log(`Unlock/list: ${report.unlockAndListMs.toFixed(1)} ms; ${report.renderedRows} rendered rows`)
      const firstPageTitle = await page.locator('.item-title').first().innerText()
      await page.locator('.n-pagination').getByText('400', { exact: true }).click()
      assert.notEqual(await page.locator('.item-title').first().innerText(), firstPageTitle)
      assert.equal(await page.locator('.item-title').count(), 25)
      report.lastPageAccessible = true
      const summaries = await call('list_items', {})
      assert.equal(summaries.length, count)
      assert.equal(summaries.some((item) => item.password || item.notes || item.fields), false)
      const item = await call('get_item', { id: summaries[0].id, recordAccess: false })
      await call('update_item', { item: { ...item, title: item.title + ' edited' } })
      assert.equal((await call('get_item', { id: item.id, recordAccess: false })).title, item.title + ' edited')
      await call('delete_item', { id: item.id })
      assert.equal((await call('list_items', {})).length, count - 1)
      await call('restore_item', { id: item.id })
      assert.equal((await call('list_items', {})).length, count)
      report.crudAtCapacity = true

      for (const surface of ['list', 'quick']) {
        if (surface === 'quick') {
          await page.getByRole('button', { name: /快捷搜索/ }).click()
          await page.getByPlaceholder('搜索名称、项目、环境、账号…').waitFor()
          await page.waitForFunction(() => !document.querySelector('.n-spin-body'))
        }
        for (const query of ['Credential 09999', 'production', 'Project 042 testing', 'not-found-value', 'private-sentinel', '']) {
          const samples = []
          for (let sample = 0; sample < 3; sample++) {
            const result = await page.evaluate(async ({ surface, query, sample }) => {
              const input = document.querySelector(surface === 'list' ? 'input[placeholder="搜索凭证…"]' : 'input[placeholder="搜索名称、项目、环境、账号…"]')
              const start = performance.now()
              input.value = query + ' '.repeat(sample)
              input.dispatchEvent(new Event('input', { bubbles: true }))
              await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))
              const selector = surface === 'list' ? '.item-title' : '#quick-search-results [role="option"]'
              return { ms: performance.now() - start, visibleRows: document.querySelectorAll(selector).length }
            }, { surface, query, sample })
            if (query === 'not-found-value' || query === 'private-sentinel') assert.equal(result.visibleRows, 0)
            else assert.ok(result.visibleRows > 0)
            samples.push(result)
          }
          report.search.push({ surface, query: query || '(empty)', samples })
          console.log(`${surface} ${query || '(empty)'}: ${samples.map(({ ms }) => ms.toFixed(1)).join(', ')} ms`)
        }
        if (surface === 'quick') await page.keyboard.press('Escape')
      }
      await page.screenshot({ path: resolve(output, `performance-${label}.png`) })
    }
    await application.close()
    application = undefined
  }
  report.targets = {
    capacity: report.crudAtCapacity,
    startupUnder1500ms: report.startupMs.every((ms) => ms < 1500),
    searchUnder100ms: report.search.every((entry) => entry.samples.every(({ ms }) => ms < 100)),
  }
  assert.deepEqual(report.errors, [])
} catch (error) {
  report.errors.push(String(error))
  throw error
} finally {
  await application?.close().catch(() => {})
  await writeFile(resolve(output, `performance-${label}.json`), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ startupMs: report.startupMs, unlockAndListMs: report.unlockAndListMs, renderedRows: report.renderedRows, targets: report.targets, errors: report.errors }))
}
