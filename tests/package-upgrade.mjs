import { restoreFromBackup } from './backup-restore.mjs'
// Seed with the previous installed release, then verify with the new installer at the same path.
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { _electron } from 'playwright-core'

const phase = process.argv[2]
assert.ok(['seed', 'verify'].includes(phase))
const output = resolve('output/playwright')
const data = resolve(process.env.JIAZI_UPGRADE_DATA)
assert.ok(data.startsWith(output + sep), 'Upgrade test requires an isolated output directory')
await mkdir(data, { recursive: true })
const backup = join(data, 'previous-release.jvault')
const fixture = join(data, 'fixture.json')
const password = 'package-upgrade-test-password'
const report = [], errors = []
let application, page
const call = (command, args) => page.evaluate(({ command, args }) => window.jiaziVault.invoke(command, args), { command, args })
const pass = (message) => { report.push(message); console.log('PASS ' + message) }
try {
  application = await _electron.launch({ executablePath: process.env.JIAZI_INSTALLED_EXE, args: [`--user-data-dir=${data}`] })
  page = await application.firstWindow()
  page.setDefaultTimeout(15000)
  page.on('pageerror', error => errors.push(error.message))
  assert.equal(await application.evaluate(({ app }) => app.isPackaged), true)
  assert.equal(await application.evaluate(({ app }) => app.getPath('userData')), data)
  await page.waitForFunction(() => Boolean(window.jiaziVault))
  if (phase === 'seed') {
    await call('create_vault', { password })
    const project = await call('create_project', { project: { name: 'Upgrade fixture' } })
    const item = await call('create_item', { item: { type: 'login', title: 'Upgrade credential', username: 'fixture', password: 'old-version-secret', projectId: project.id, favorite: true } })
    const trashed = await call('create_item', { item: { type: 'password', title: 'Upgrade trash', password: 'trash-secret', favorite: false } })
    await call('delete_item', { id: trashed.id })
    await application.evaluate(({ dialog }, path) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: path }) }, backup)
    await call('create_backup')
    await writeFile(fixture, JSON.stringify({ itemId: item.id, trashedId: trashed.id, projectId: project.id, version: await application.evaluate(({ app }) => app.getVersion()) }))
    pass('previous installed release creates an encrypted vault, project, trash and portable backup')
  } else {
    const previous = JSON.parse(await readFile(fixture, 'utf8'))
    const pkg = JSON.parse(await readFile('package.json', 'utf8'))
    assert.equal(await application.evaluate(({ app }) => app.getVersion()), pkg.version)
    async function unlock() {
      await page.getByRole('heading', { name: '解锁保险库', exact: true }).waitFor()
      await page.getByPlaceholder('主密码', { exact: true }).fill(password)
      await page.getByRole('button', { name: '解锁', exact: true }).click()
      await page.getByRole('heading', { name: '全部条目', exact: true }).waitFor()
    }
    await unlock()
    assert.equal((await call('get_item', { id: previous.itemId })).password, 'old-version-secret')
    assert.equal((await call('list_projects'))[0].id, previous.projectId)
    assert.equal((await call('list_items', { trashed: true }))[0].id, previous.trashedId)
    pass(`new installed release opens the database from v${previous.version}, preserving secrets, projects and trash`)
    await call('update_item', { item: { ...await call('get_item', { id: previous.itemId }), password: 'new-version-secret' } })
    assert.equal((await call('list_item_history', { id: previous.itemId })).length, 1)
    await application.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
      dialog.showMessageBox = async () => ({ response: 1 })
    }, backup)
    assert.equal(await restoreFromBackup(call, { password }), true)
    await unlock()
    assert.equal((await call('get_item', { id: previous.itemId })).password, 'old-version-secret')
    const snapshots = await call('list_recovery_snapshots')
    assert.equal(snapshots.length, 1)
    assert.equal(await restoreFromBackup(call, { password, snapshotId: snapshots[0].id }), true)
    await unlock()
    assert.equal((await call('get_item', { id: previous.itemId })).password, 'new-version-secret')
    pass('old backup restores successfully and the pre-restore snapshot recovers the new data')
  }
  assert.deepEqual(errors, [])
} catch (error) {
  errors.push(String(error))
  await page?.screenshot({ path: join(data, `${phase}-failure.png`) }).catch(() => {})
  throw error
} finally {
  await application?.close().catch(() => {})
  await writeFile(join(data, `${phase}-report.json`), JSON.stringify({ report, errors, data }, null, 2))
}
