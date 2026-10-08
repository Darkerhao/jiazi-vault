import assert from 'node:assert/strict'
import { mkdir, readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import electron from 'electron'
import { _electron } from 'playwright-core'
import { createVaultThroughUI } from './onboarding.mjs'

const root = process.cwd(), output = resolve(root, 'output/playwright/data-recovery')
const data = join(output, `data-${Date.now()}`), target = join(data, 'external-backups')
await mkdir(target, { recursive: true })
const installed = process.env.JIAZI_INSTALLED_EXE
const app = await _electron.launch({ executablePath: installed || electron, args: installed ? [`--user-data-dir=${data}`] : [resolve('tests/electron-launch.cjs')], cwd: root, timeout: 30000, env: { ...process.env, JIAZI_TEST_DATA: data } })
const page = await app.firstWindow()
page.setDefaultTimeout(15000)
const errors = [], passed = []
page.on('pageerror', (error) => errors.push(error.message))
const pass = (name) => { passed.push(name); console.log(`PASS ${name}`) }
const call = (command, args) => page.evaluate(({ command, args }) => window.jiaziVault.invoke(command, args), { command, args })
const password = 'recovery-desktop-password'
async function section(name) {
  await page.getByRole('link', { name, exact: true }).click()
  await page.getByRole('heading', { name, exact: true }).waitFor()
}
async function unlock() {
  await page.getByPlaceholder('主密码', { exact: true }).fill(password)
  await page.getByRole('button', { name: '解锁', exact: true }).click()
  await page.getByRole('heading', { name: '全部条目', exact: true }).waitFor()
}
try {
  await createVaultThroughUI(page, password)
  const item = await call('create_item', { item: { type: 'password', title: '恢复测试凭证', password: 'old-desktop-secret', favorite: false } })
  await call('update_item', { item: { ...await call('get_item', { id: item.id }), password: 'new-desktop-secret' } })
  await section('设置')
  await section('全部条目')
  await page.getByRole('button', { name: item.title, exact: true }).click()
  const detail = page.getByRole('dialog')
  await detail.getByRole('button', { name: '历史版本', exact: true }).click()
  await detail.locator('.n-select').filter({ hasText: '选择历史版本' }).click()
  await page.locator('.n-base-select-option').filter({ hasText: '修改前版本 1' }).click()
  await detail.getByText(`历史名称：${item.title}`, { exact: true }).waitFor()
  assert.ok(!(await detail.innerText()).includes('old-desktop-secret'))
  await detail.getByRole('button', { name: '历史密码显示', exact: true }).click()
  await detail.getByText('old-desktop-secret', { exact: true }).waitFor()
  await detail.getByRole('button', { name: '恢复此版本', exact: true }).click()
  await page.getByRole('button', { name: '确认恢复版本', exact: true }).click()
  await page.getByText('已恢复历史版本', { exact: true }).waitFor()
  assert.equal((await call('get_item', { id: item.id })).password, 'old-desktop-secret')
  assert.equal((await call('list_item_history', { id: item.id })).length, 2)
  pass('history preview is masked; explicit reveal and restore preserve current content as history')

  await section('设置')
  await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }) }, target)
  await page.getByRole('button', { name: '选择目录并启用', exact: true }).click()
  await page.getByRole('button', { name: '立即自动备份', exact: true }).waitFor()
  await page.getByText(/最近自动备份：.*文件存在/).waitFor()
  const automatic = await call('get_automatic_backup_status')
  assert.ok(automatic.directory.startsWith(target))
  const [file] = await readdir(automatic.directory)
  const backupPath = join(automatic.directory, file)
  assert.ok(!(await readFile(backupPath, 'utf8')).includes('old-desktop-secret'))
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 600))
  await page.locator('.automatic-backup').scrollIntoViewIfNeeded()
  await page.screenshot({ path: join(output, 'automatic-backup.png') })
  pass('UI enables automatic backups in a managed directory and reports an actual encrypted file')

  await unlink(backupPath)
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('backup_changed'))
  await page.getByText('最近的自动备份文件已不存在，请立即重新备份。', { exact: true }).waitFor()
  await page.getByRole('button', { name: '立即自动备份', exact: true }).click()
  await page.getByText(/最近自动备份：.*文件存在/).waitFor()
  const files = await readdir(automatic.directory)
  const replacementPath = join(automatic.directory, files[0])
  await page.getByRole('button', { name: '停用自动备份', exact: true }).click()
  await page.getByRole('button', { name: '选择目录并启用', exact: true }).waitFor()
  assert.equal((await call('get_automatic_backup_status')).directory, null)
  assert.ok((await readdir(automatic.directory)).length > 0)
  pass('missing backup is visible, retry recreates it, and disabling preserves saved files')

  await call('update_item', { item: { ...await call('get_item', { id: item.id }), password: 'keep-in-snapshot' } })
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
    dialog.showMessageBox = async () => ({ response: 1 })
  }, replacementPath)
  await call('lock_vault')
  await page.getByRole('heading', { name: '解锁保险库', exact: true }).waitFor()
  const version = (await call('list_recovery_snapshots')).length
  await assert.rejects(call('list_item_history', { id: item.id }), /VAULT_LOCKED/)
  await assert.rejects(call('get_item_history', { id: item.id, historyId: 1 }), /VAULT_LOCKED/)
  await assert.rejects(call('restore_item_history', { id: item.id, historyId: 1 }), /VAULT_LOCKED/)
  await assert.rejects(call('run_automatic_backup'), /VAULT_LOCKED/)
  assert.equal(await call('restore_backup', { password }), true)
  const snapshots = await call('list_recovery_snapshots')
  assert.equal(snapshots.length, version + 1)
  await unlock()
  assert.equal((await call('get_item', { id: item.id })).password, 'old-desktop-secret')
  pass('locked vault denies history access and creates a recovery snapshot before backup replacement')

  await section('设置')
  await page.getByRole('button', { name: '从加密备份恢复', exact: true }).click()
  const restore = page.getByRole('dialog')
  await restore.locator('.n-select').click()
  await page.locator('.n-base-select-option').filter({ hasText: '恢复前快照' }).first().click()
  await restore.getByPlaceholder('备份创建时使用的主密码').fill(password)
  await page.screenshot({ path: join(output, 'recovery-snapshot.png') })
  await restore.getByRole('button', { name: '恢复所选快照', exact: true }).click()
  await page.getByRole('heading', { name: '解锁保险库', exact: true }).waitFor()
  await unlock()
  assert.equal((await call('get_item', { id: item.id })).password, 'keep-in-snapshot')
  pass('snapshot selection and original password undo a completed replacement from the UI')

  const recoveryPath = join(data, 'recovery'), kept = join(data, 'recovery-kept')
  await rename(recoveryPath, kept)
  await writeFile(recoveryPath, 'fixture blocks recovery directory')
  await assert.rejects(call('restore_backup', { password }), /RECOVERY_SNAPSHOT_FAILED/)
  assert.equal((await call('get_item', { id: item.id })).password, 'keep-in-snapshot')
  await unlink(recoveryPath)
  await rename(kept, recoveryPath)
  pass('a snapshot write failure blocks replacement and preserves current credentials')
  assert.deepEqual(errors, [])
  await writeFile(join(output, 'report.json'), JSON.stringify({ passed, errors }, null, 2))
} catch (error) {
  await page.screenshot({ path: join(output, 'failure.png') }).catch(() => {})
  throw error
} finally { await app.close() }
