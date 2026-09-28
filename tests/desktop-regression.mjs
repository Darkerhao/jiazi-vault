import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdir, mkdtemp, readFile, readdir, writeFile, open } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import electron from 'electron'
import { _electron } from 'playwright-core'
import { openDatabase } from '../dist-electron/database.js'
import { createVaultCredential, clearKey } from '../dist-electron/vault-crypto.js'
import { createItemStore } from '../dist-electron/item-store.js'
import { createBackup } from '../dist-electron/backup.js'

const root = process.cwd(), output = resolve(root, 'output/playwright')
const password = 'desktop-regression-master-password'
await mkdir(output, { recursive: true })

async function fixture(count = 2) {
  const data = await mkdtemp(join(output, 'regression-'))
  const db = openDatabase(data)
  const credential = await createVaultCredential(password)
  try {
    db.connection.prepare('INSERT INTO vault_metadata VALUES (?, ?)').run('vault', JSON.stringify(credential.metadata))
    const store = createItemStore(db.connection, () => credential.masterKey)
    db.connection.exec('BEGIN')
    for (let i = 0; i < count; i++) store.create(i === 1
      ? { type: 'database', title: 'Review Database', fields: { connectionString: 'postgres://review:fixture-password@localhost/example' }, favorite: false }
      : { type: 'ssh', title: `Review SSH ${i}`, fields: { privateKey: 'review-placeholder-'.repeat(count > 2 ? 216 : 2) }, favorite: false })
    db.connection.exec('COMMIT')
    return { data, backup: createBackup(db.connection, credential.metadata, credential.masterKey) }
  } finally { clearKey(credential.masterKey); db.connection.close() }
}

async function launch(t, data) {
  const application = await _electron.launch({ executablePath: electron, args: [resolve(root, 'tests/electron-launch.cjs')], cwd: root, env: { ...process.env, JIAZI_TEST_DATA: data } })
  t.after(() => application.close())
  const page = await application.firstWindow({ timeout: 5000 })
  page.setDefaultTimeout(5000)
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  t.after(() => assert.deepEqual(errors, []))
  const call = (command, args) => page.evaluate(({ command, args }) => window.jiaziVault.invoke(command, args), { command, args })
  const unlock = async () => {
    await page.getByPlaceholder('主密码', { exact: true }).fill(password)
    await page.getByRole('button', { name: '解锁', exact: true }).click()
    await page.getByRole('heading', { name: '全部条目', exact: true }).waitFor()
  }
  return { application, page, call, unlock }
}

test('damaged database opens recovery, rejects a wrong password, preserves original files and restores a usable vault', async (t) => {
  const source = await fixture()
  const data = await mkdtemp(join(output, 'regression-corrupt-'))
  const original = Buffer.from('fixture-only corrupt database')
  await writeFile(join(data, 'vault.db'), original)
  const backupPath = join(data, 'restore.jvault')
  await writeFile(backupPath, source.backup)
  const { application, page, call, unlock } = await launch(t, data)
  await page.getByRole('heading', { name: '无法打开保险库' }).waitFor()
  assert.equal(await page.getByRole('button', { name: '从加密备份恢复' }).isVisible(), true)
  await application.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
  }, backupPath)
  await assert.rejects(call('restore_backup', { password: 'wrong-backup-password' }), /BACKUP_RESTORE_FAILED/)
  assert.deepEqual(await readFile(join(data, 'vault.db')), original)
  await page.getByRole('button', { name: '从加密备份恢复' }).click()
  await page.getByPlaceholder('备份创建时使用的主密码').fill(password)
  await page.getByRole('button', { name: '选择文件并恢复' }).click()
  await page.getByRole('heading', { name: '解锁保险库' }).waitFor()
  const saved = await readdir(join(data, 'recovery'))
  assert.equal(saved.length, 1)
  assert.deepEqual(await readFile(join(data, 'recovery', saved[0], 'vault.db')), original)
  await unlock()
  assert.equal((await call('list_items', {})).length, 2)
})

test('a backup larger than 64 MiB exports and restores; files beyond 256 MiB are rejected before replacement', async (t) => {
  const { data, backup } = await fixture(10000)
  assert.ok(Buffer.byteLength(backup) > 64 * 1024 * 1024)
  const { application, call, unlock } = await launch(t, data)
  await unlock()
  const backupPath = join(data, 'large.jvault')
  await application.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: path })
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
    dialog.showMessageBox = async () => ({ response: 1 })
  }, backupPath)
  assert.equal(await call('create_backup'), 'large.jvault')
  assert.ok((await readFile(backupPath)).length > 64 * 1024 * 1024)
  assert.equal(await call('restore_backup', { password }), true)
  await unlock()
  assert.equal((await call('list_items', {})).length, 10000)
  const oversized = await open(backupPath, 'w')
  try { await oversized.truncate(256 * 1024 * 1024 + 1) } finally { await oversized.close() }
  await assert.rejects(call('restore_backup', { password }), /BACKUP_TOO_LARGE/)
  assert.equal((await call('list_items', {})).length, 10000)
})

test('private keys and connection strings start hidden, reveal exact values and remain unchanged on save', async (t) => {
  const { data } = await fixture()
  const { page, call, unlock } = await launch(t, data)
  await unlock()
  for (const [title, label, expected] of [
    ['Review SSH 0', '私钥', 'review-placeholder-'.repeat(2)],
    ['Review Database', '连接串', 'postgres://review:fixture-password@localhost/example'],
  ]) {
    await page.locator('.item-main').filter({ hasText: title }).click()
    assert.equal(await page.getByPlaceholder(label, { exact: true }).inputValue(), '••••••••')
    await page.getByRole('button', { name: `显示${label}`, exact: true }).click()
    assert.equal(await page.getByPlaceholder(label, { exact: true }).inputValue(), expected)
    await page.getByRole('button', { name: `隐藏${label}`, exact: true }).click()
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await page.getByPlaceholder(label, { exact: true }).waitFor({ state: 'hidden' })
    const summary = (await call('list_items', {})).find((item) => item.title === title)
    const full = await call('get_item', { id: summary.id, recordAccess: false })
    assert.equal(Object.values(full.fields)[0], expected)
  }
})

test('draft dismissal and navigation require confirmation; saving blocks dismissal and system lock clears the editor', async (t) => {
  const { data } = await fixture()
  const { application, page, unlock } = await launch(t, data)
  await unlock()
  await page.getByRole('button', { name: '新建', exact: true }).click()
  await page.getByPlaceholder('凭证名称', { exact: true }).fill('Unsaved credential')
  await page.getByPlaceholder('密码', { exact: true }).fill('fixture-only-new-secret')
  await page.keyboard.press('Escape')
  await page.getByText('放弃未保存的修改？', { exact: true }).waitFor()
  await page.getByRole('button', { name: '继续编辑', exact: true }).click()
  await page.getByText('放弃未保存的修改？', { exact: true }).waitFor({ state: 'hidden' })
  assert.equal(await page.getByPlaceholder('凭证名称', { exact: true }).inputValue(), 'Unsaved credential')
  await page.keyboard.press('Control+g')
  await page.getByText('放弃未保存的修改？', { exact: true }).waitFor()
  await page.getByRole('button', { name: '继续编辑', exact: true }).click()
  await page.getByText('放弃未保存的修改？', { exact: true }).waitFor({ state: 'hidden' })
  assert.ok(page.url().endsWith('/vault'))
  await application.evaluate(({ ipcMain }) => {
    globalThis.pendingLists = []
    ipcMain.removeHandler('list_items')
    ipcMain.handle('list_items', () => new Promise((resolve) => globalThis.pendingLists.push(resolve)))
  })
  await page.getByRole('button', { name: '保存', exact: true }).click()
  assert.equal(await page.getByRole('button', { name: '取消', exact: true }).isDisabled(), true)
  await page.keyboard.press('Escape')
  assert.equal(await page.getByPlaceholder('凭证名称', { exact: true }).isVisible(), true)
  await application.evaluate(({ powerMonitor }) => powerMonitor.emit('lock-screen'))
  await page.getByRole('heading', { name: '解锁保险库' }).waitFor()
  assert.equal(await page.getByRole('dialog').count(), 0)
  await application.evaluate(() => globalThis.pendingLists.forEach((resolve) => resolve([])))
})

test('only the application main frame can call IPC, while external navigation and popups are blocked', async (t) => {
  const { data } = await fixture()
  const { application, page, call, unlock } = await launch(t, data)
  await unlock()
  assert.equal((await call('get_settings')).clipboardClearTimeout, 15)
  const rejected = await application.evaluate(async ({ BrowserWindow, app }) => {
    const other = new BrowserWindow({ show: false, webPreferences: { preload: app.getAppPath() + '/dist-electron/preload.cjs', sandbox: true, contextIsolation: true, nodeIntegration: false } })
    try {
      await other.loadURL('about:blank')
      return await other.webContents.executeJavaScript("window.jiaziVault.invoke('get_settings').then(() => 'accepted', error => error.message)")
    } finally { other.destroy() }
  })
  assert.match(rejected, /INVALID_IPC_SENDER/)
  await application.evaluate(({ BrowserWindow }) => {
    const contents = BrowserWindow.getAllWindows()[0].webContents
    globalThis.blockedNavigation = new Promise((resolve) => contents.once('will-frame-navigate', (event) => resolve(event.defaultPrevented)))
  })
  await page.evaluate(() => {
    window.open('about:blank')
    const link = document.createElement('a')
    link.href = 'https://example.invalid/'
    document.body.append(link)
    link.click()
    link.remove()
  })
  assert.equal(await application.evaluate(() => globalThis.blockedNavigation), true)
  assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1)
  await page.getByRole('heading', { name: '解锁保险库' }).waitFor()
  assert.ok(page.url().startsWith('file:'))
  assert.equal(await call('is_vault_unlocked'), false)
  // Chromium commits about:blank without the cancellable network navigation events.
  // Even that document must never inherit access to the vault's IPC.
  await page.evaluate(() => { window.location.href = 'about:blank' })
  await page.waitForURL('about:blank')
  await assert.rejects(call('get_settings'), /INVALID_IPC_SENDER/)
})
