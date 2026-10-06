import { backupRevision, readBackupStatus, recordBackup } from './backup-status.js'
import { basename, extname, join } from 'node:path'
import { readFile, stat } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { app, BrowserWindow, clipboard, dialog, ipcMain, powerMonitor } from 'electron'
import { openDatabase, purgeExpiredItems, type DatabaseState } from './database.js'
import { clearKey, createVaultCredential, isVaultMetadata, type CreatedVaultCredential, type VaultMetadata, unlockVaultCredential } from './vault-crypto.js'
import { createItemStore, type ItemInput, type VaultItem } from './item-store.js'
import { DEFAULT_SETTINGS, readSettings, writeSettings, type AppSettings } from './settings.js'
import { VaultSession } from './vault-session.js'
import { ClipboardManager } from './clipboard-manager.js'
import { assertBackupSize, createBackup, readBackup, restoreBackup } from './backup.js'
import { recoverDatabase } from './database-recovery.js'
import { UnlockLimiter } from './unlock-limiter.js'
import { createProjectStore, type ProjectInput } from './project-store.js'
import { generatePassword, type PasswordOptions } from './password-generator.js'
import { createDesktopControls } from './desktop.js'
import { assertTransferFormat, exportPlaintext, parseImport, previewImport, importReviewed, type ImportRecord, type TransferFormat } from './transfer.js'
import { replaceVaultPassword } from './vault-password.js'
import { BiometricVault } from './biometric-vault.js'
import { createBiometricProvider } from './biometric-provider.js'
import { ENV_MAX_BYTES, serializeEnv, validateEnvFields } from './env.js'
import { writePrivateFile } from './private-file.js'
import { automaticBackupStatus, runAutomaticBackup, setAutomaticBackupDirectory } from './automatic-backup.js'
import { createRecoverySnapshot, listRecoverySnapshots, readRecoverySnapshot } from './recovery-snapshot.js'

let mainWindow: BrowserWindow | null = null
let database: DatabaseState | null = null
let settings: AppSettings = { ...DEFAULT_SETTINGS }
let session: VaultSession
let clipboardManager: ClipboardManager
let vaultOperationBusy = false
let unlockLimiter: UnlockLimiter
let desktop: ReturnType<typeof createDesktopControls>
let trashTimer: ReturnType<typeof setInterval> | undefined
let backupTimer: ReturnType<typeof setInterval> | undefined
let pendingImport: { token: string; revision: number; records: ImportRecord[] } | null = null
let biometric: BiometricVault
let itemStore: ReturnType<typeof createItemStore>
let projects: ReturnType<typeof createProjectStore>

function initializeDatabase() {
  const opened = openDatabase(app.getPath('userData'))
  try {
    settings = readSettings(opened.connection)
    unlockLimiter = new UnlockLimiter(opened.connection)
    itemStore = createItemStore(opened.connection, requireUnlocked)
    projects = createProjectStore(opened.connection)
    biometric = new BiometricVault(opened.connection, createBiometricProvider(() => mainWindow))
    database = opened
  } catch (error) {
    opened.connection.close()
    throw error
  }
}

function applicationUrl() {
  return app.isPackaged ? pathToFileURL(join(app.getAppPath(), 'dist', 'index.html')).href : 'http://127.0.0.1:1420/'
}

function isApplicationUrl(value: string) {
  try {
    const url = new URL(value)
    url.hash = ''
    return url.href === applicationUrl()
  } catch { return false }
}

const recoveryCommands = new Set(['health_check', 'get_desktop_status', 'get_vault_status', 'is_vault_unlocked', 'lock_vault', 'get_settings', 'restore_backup', 'list_recovery_snapshots'])

function handleIpc(channel: string, listener: Parameters<typeof ipcMain.handle>[1]) {
  ipcMain.handle(channel, (event, ...args) => {
    const contents = mainWindow?.webContents
    if (!contents || event.sender !== contents || event.senderFrame !== contents.mainFrame
      || !isApplicationUrl(event.senderFrame.url)) throw new Error('INVALID_IPC_SENDER')
    if (!database && !recoveryCommands.has(channel)) throw new Error('DATABASE_ERROR')
    return listener(event, ...args)
  })
}

function cleanTrash() {
  if (database && purgeExpiredItems(database.connection)) mainWindow?.webContents.send('items_changed')
}

function requireDatabase() {
  if (!database) throw new Error('DATABASE_ERROR')
  return database
}

function readVaultMetadata(): VaultMetadata | null {
  const row = requireDatabase().connection.prepare('SELECT value FROM vault_metadata WHERE key = ?').get('vault') as { value?: string } | undefined
  if (!row?.value) return null
  try {
    const metadata: unknown = JSON.parse(row.value)
    if (!isVaultMetadata(metadata)) throw new Error('DATABASE_ERROR')
    return metadata
  } catch {
    throw new Error('DATABASE_ERROR')
  }
}

function assertPassword(password: unknown) {
  if (typeof password !== 'string' || password.length < 8) throw new Error('PASSWORD_TOO_SHORT')
}

function requireUnlocked(): Buffer {
  return session.requireKey()
}

async function verifyCurrentPassword(password: string) {
  if (unlockLimiter.retryAt) throw new Error('UNLOCK_RATE_LIMITED')
  const metadata = readVaultMetadata()
  if (!metadata) throw new Error('VAULT_NOT_FOUND')
  const key = await unlockVaultCredential(password, metadata)
  if (!key) { unlockLimiter.fail(); throw new Error('INVALID_PASSWORD') }
  return key
}

function hasVault() {
  return Boolean(requireDatabase().connection.prepare('SELECT 1 FROM vault_metadata WHERE key = ?').get('vault'))
}

function assertRevision(revision: number) {
  session.checkExpiry()
  if (session.revision !== revision) throw new Error('VAULT_LOCKED')
}

function createWindow() {
  mainWindow = new BrowserWindow({
    title: 'Keystill',
    icon: join(app.getAppPath(), app.isPackaged ? 'dist' : 'public', 'brand', 'icon.png'),
    width: 1200,
    height: 760,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#20251f',
    webPreferences: {
      preload: join(import.meta.dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  mainWindow.webContents.on('before-input-event', () => session.touch())
  mainWindow.webContents.on('before-mouse-event', () => session.touch())
  mainWindow.webContents.on('render-process-gone', () => session.lock())
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  mainWindow.webContents.on('will-frame-navigate', (event) => {
    if (!event.isMainFrame || !isApplicationUrl(event.url)) event.preventDefault()
  })
  mainWindow.webContents.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => {
    if (isMainFrame && !isInPlace) session.lock()
  })
  mainWindow.on('close', (event) => {
    session.lock()
    if (!quitting) { event.preventDefault(); mainWindow?.hide() }
  })
  mainWindow.on('closed', () => { mainWindow = null })

  if (app.isPackaged) {
    void mainWindow.loadFile(join(app.getAppPath(), 'dist', 'index.html'))
  } else {
    void mainWindow.loadURL('http://127.0.0.1:1420')
  }
  return mainWindow
}

function registerIpcHandlers() {
  handleIpc('health_check', () => 'ok')
  handleIpc('get_desktop_status', () => desktop.status)
  handleIpc('database_info', () => {
    const currentDatabase = requireDatabase()
    currentDatabase.connection.prepare('SELECT 1').get()
    return { initialized: true, path: currentDatabase.path }
  })
  handleIpc('get_vault_status', () => ({ exists: database ? hasVault() : false, unlocked: session.unlocked, retryAt: database ? unlockLimiter.retryAt : 0, databaseError: !database }))
  handleIpc('is_vault_unlocked', () => session.unlocked)
  handleIpc('lock_vault', () => session.lock())
  handleIpc('get_settings', () => settings)
  handleIpc('update_settings', (_event, args: { settings: AppSettings }) => {
    requireUnlocked()
    settings = writeSettings(requireDatabase().connection, args?.settings)
    session.checkExpiry()
    clipboardManager.reschedule()
    return settings
  })
  handleIpc('copy_to_clipboard', async (_event, args: { text: string; itemId?: string }) => {
    requireUnlocked()
    if (typeof args?.text !== 'string') throw new Error('INVALID_DATA')
    const revision = session.revision
    await clipboardManager.copy(args.text, () => { assertRevision(revision); requireUnlocked() })
    assertRevision(revision)
    return args.itemId ? itemStore.markUsed(args.itemId) : null
  })
  handleIpc('generate_password', (_event, args: PasswordOptions) => {
    requireUnlocked()
    return generatePassword(args)
  })
  handleIpc('create_vault', async (_event, args: { password: string }) => {
    if (vaultOperationBusy) throw new Error('VAULT_BUSY')
    assertPassword(args?.password)
    if (readVaultMetadata()) throw new Error('VAULT_EXISTS')
    let metadata: VaultMetadata
    await session.authenticate(async () => {
      const credential = await createVaultCredential(args.password)
      metadata = credential.metadata
      return credential.masterKey
    }, () => {
      requireDatabase().connection.prepare('INSERT INTO vault_metadata (key, value) VALUES (?, ?)').run('vault', JSON.stringify(metadata))
    })
  })
  handleIpc('unlock_vault', async (_event, args: { password: string }) => {
    if (vaultOperationBusy) throw new Error('VAULT_BUSY')
    if (unlockLimiter.retryAt) return { unlocked: false, retryAt: unlockLimiter.retryAt }
    if (typeof args?.password !== 'string') throw new Error('INVALID_DATA')
    const metadata = readVaultMetadata()
    if (!metadata) throw new Error('VAULT_NOT_FOUND')
    const unlocked = await session.authenticate(
      () => args.password.length < 8 ? Promise.resolve(null) : unlockVaultCredential(args.password, metadata),
      () => unlockLimiter.reset(),
    )
    return { unlocked, retryAt: unlocked ? 0 : unlockLimiter.fail() }
  })
  handleIpc('get_biometric_status', () => biometric.status())
  handleIpc('enable_biometric', async (_event, args: { password: string }) => {
    requireUnlocked()
    assertPassword(args?.password)
    if (vaultOperationBusy) throw new Error('VAULT_BUSY')
    vaultOperationBusy = true
    let encrypted = ''
    try {
      await session.authenticate(async () => {
        const key = await verifyCurrentPassword(args.password)
        try { encrypted = await biometric.prepare(key); return key }
        catch (error) { clearKey(key); throw error }
      }, () => { biometric.save(encrypted); unlockLimiter.reset() })
    } finally { vaultOperationBusy = false }
  })
  handleIpc('disable_biometric', () => {
    requireUnlocked()
    if (vaultOperationBusy) throw new Error('VAULT_BUSY')
    biometric.disable()
  })
  handleIpc('unlock_biometric', async () => {
    if (vaultOperationBusy) throw new Error('VAULT_BUSY')
    const metadata = readVaultMetadata()
    if (!metadata) throw new Error('VAULT_NOT_FOUND')
    vaultOperationBusy = true
    try {
      await session.authenticate(() => biometric.unlock(metadata), () => unlockLimiter.reset())
    } finally { vaultOperationBusy = false }
  })
  handleIpc('change_master_password', async (_event, args: { currentPassword: string; newPassword: string }) => {
    requireUnlocked()
    assertPassword(args?.currentPassword)
    assertPassword(args?.newPassword)
    if (args.currentPassword === args.newPassword) throw new Error('PASSWORD_UNCHANGED')
    if (vaultOperationBusy) throw new Error('VAULT_BUSY')
    vaultOperationBusy = true
    let credential: CreatedVaultCredential
    try {
      await session.authenticate(async () => {
        const verifiedKey = await verifyCurrentPassword(args.currentPassword)
        clearKey(verifiedKey)
        credential = await createVaultCredential(args.newPassword)
        return credential.masterKey
      }, () => replaceVaultPassword(requireDatabase().connection, requireUnlocked(), credential))
      session.lock()
    } finally { vaultOperationBusy = false }
  })
  handleIpc('list_items', (_event, args?: { trashed?: boolean }) => {
    requireUnlocked()
    cleanTrash()
    return itemStore.list(args?.trashed ?? false)
  })
  handleIpc('get_item', (_event, args: { id: string; recordAccess?: boolean }) => {
    requireUnlocked()
    cleanTrash()
    return itemStore.get(args?.id, args?.recordAccess !== false)
  })
  handleIpc('create_item', (_event, args: { item: ItemInput }) => {
    requireUnlocked()
    return itemStore.create(args?.item)
  })
  handleIpc('update_item', (_event, args: { item: VaultItem }) => {
    requireUnlocked()
    return itemStore.update(args?.item)
  })
  handleIpc('list_item_history', (_event, args: { id: string }) => {
    requireUnlocked()
    return itemStore.listHistory(args?.id)
  })
  handleIpc('get_item_history', (_event, args: { id: string; historyId: number }) => {
    requireUnlocked()
    return itemStore.getHistory(args?.id, args?.historyId)
  })
  handleIpc('restore_item_history', (_event, args: { id: string; historyId: number }) => {
    requireUnlocked()
    cleanTrash()
    return itemStore.restoreHistory(args?.id, args?.historyId)
  })
  handleIpc('toggle_favorite', (_event, args: { id: string }) => {
    requireUnlocked()
    return itemStore.toggleFavorite(args?.id)
  })
  handleIpc('delete_item', (_event, args: { id: string; permanently?: boolean }) => {
    requireUnlocked()
    itemStore.remove(args?.id, args?.permanently)
  })
  handleIpc('restore_item', (_event, args: { id: string }) => {
    requireUnlocked()
    cleanTrash()
    if (!itemStore.get(args?.id)) throw new Error('ITEM_NOT_FOUND')
    itemStore.restore(args?.id)
  })
  handleIpc('list_projects', () => {
    requireUnlocked()
    return projects.list()
  })
  handleIpc('create_project', (_event, args: { project: ProjectInput }) => {
    requireUnlocked()
    return projects.create(args?.project)
  })
  handleIpc('update_project', (_event, args: { project: ProjectInput & { id: string } }) => {
    requireUnlocked()
    return projects.update(args?.project)
  })
  handleIpc('delete_project', (_event, args: { id: string }) => {
    requireUnlocked()
    projects.remove(args?.id)
  })
  handleIpc('visit_project', (_event, args: { id: string }) => {
    requireUnlocked()
    return projects.visit(args?.id)
  })
  registerBackupHandlers()
  registerTransferHandlers()
  registerEnvHandlers()
}

function registerEnvHandlers() {
  handleIpc('read_env_file', async () => {
    requireUnlocked()
    if (vaultOperationBusy || !mainWindow) throw new Error('VAULT_BUSY')
    vaultOperationBusy = true
    const revision = session.revision
    try {
      const choice = await dialog.showOpenDialog(mainWindow, {
        title: '导入 .env 文件', properties: ['openFile', 'showHiddenFiles'],
        filters: [{ name: '.env / 环境配置文件', extensions: ['*'] }],
      })
      assertRevision(revision)
      if (choice.canceled || !choice.filePaths[0]) return null
      const path = choice.filePaths[0]
      if ((await stat(path)).size > ENV_MAX_BYTES) throw new Error('ENV_FILE_TOO_LARGE')
      const bytes = await readFile(path)
      assertRevision(revision)
      requireUnlocked()
      if (bytes.length > ENV_MAX_BYTES) throw new Error('ENV_FILE_TOO_LARGE')
      return { name: basename(path), contents: new TextDecoder('utf-8', { fatal: true }).decode(bytes) }
    } catch { throw new Error('ENV_IMPORT_FAILED') }
    finally { vaultOperationBusy = false }
  })
  handleIpc('export_env', async (_event, args: { fields: Record<string, string>; destination: 'clipboard' | 'file'; itemId?: string }) => {
    requireUnlocked()
    validateEnvFields(args?.fields)
    if (!['clipboard', 'file'].includes(args?.destination)) throw new Error('INVALID_DATA')
    if (vaultOperationBusy || !mainWindow) throw new Error('VAULT_BUSY')
    const contents = serializeEnv(args.fields)
    const revision = session.revision
    vaultOperationBusy = true
    try {
      const toFile = args.destination === 'file'
      const confirmation = await dialog.showMessageBox(mainWindow, {
        type: 'warning', title: toFile ? '导出明文 .env' : '复制完整 .env',
        message: `即将将全部变量值以明文${toFile ? '写入文件' : '复制到系统剪贴板'}。`,
        detail: toFile ? '文件不受保险库加密保护。请妥善保管，避免提交到版本库。' : '其他应用可能读取剪贴板。复制后按当前剪贴板清理设置处理，锁定时也会清理。',
        buttons: ['取消', toFile ? '确认导出明文' : '确认复制明文'], defaultId: 0, cancelId: 0, noLink: true,
      })
      assertRevision(revision)
      requireUnlocked()
      if (confirmation.response !== 1) return null
      if (!toFile) {
        await clipboardManager.copy(contents, () => { assertRevision(revision); requireUnlocked() })
        assertRevision(revision)
        return { name: '.env', usedAt: args.itemId ? itemStore.markUsed(args.itemId) : null }
      }
      const choice = await dialog.showSaveDialog(mainWindow, { title: '导出 .env', defaultPath: '.env', filters: [{ name: '环境配置文件', extensions: ['*'] }] })
      assertRevision(revision)
      requireUnlocked()
      if (choice.canceled || !choice.filePath) return null
      await writeExport(choice.filePath, contents, revision)
      return { name: basename(choice.filePath), usedAt: args.itemId ? itemStore.markUsed(args.itemId) : null }
    } catch { throw new Error('ENV_EXPORT_FAILED') }
    finally { vaultOperationBusy = false }
  })
}

async function writeExport(path: string, contents: string, revision: number) {
  await writePrivateFile(path, contents, () => { assertRevision(revision); requireUnlocked() })
}

async function automaticBackup(force = false) {
  if (!database || !session.unlocked) return
  if (vaultOperationBusy) { if (force) throw new Error('VAULT_BUSY'); return }
  vaultOperationBusy = true
  const revision = session.revision
  try {
    await runAutomaticBackup(database.connection,
      () => createBackup(requireDatabase().connection, readVaultMetadata()!, requireUnlocked()),
      () => { assertRevision(revision); requireUnlocked() }, force)
  } catch { if (force) throw new Error('AUTOMATIC_BACKUP_FAILED') }
  finally {
    vaultOperationBusy = false
    if (mainWindow && !mainWindow.webContents.isDestroyed()) mainWindow.webContents.send('backup_changed')
  }
}

function registerTransferHandlers() {
  handleIpc('export_plaintext', async (_event, args: { format: TransferFormat }) => {
    requireUnlocked()
    assertTransferFormat(args?.format)
    if (vaultOperationBusy || !mainWindow) throw new Error('VAULT_BUSY')
    vaultOperationBusy = true
    const revision = session.revision
    try {
      const confirmation = await dialog.showMessageBox(mainWindow, {
        type: 'warning', title: '导出明文凭证', message: '即将以明文导出密码、私钥及其他敏感信息。',
        detail: '任何获得此文件的人都可以读取其中的凭证。仅导出有效凭证，不包含回收站。请妥善保管并在使用后删除明文文件。',
        buttons: ['取消', '确认导出明文'], defaultId: 0, cancelId: 0, noLink: true,
      })
      if (confirmation.response !== 1) return null
      assertRevision(revision)
      requireUnlocked()
      const format = args.format
      const choice = await dialog.showSaveDialog(mainWindow, {
        title: `导出 ${format.toUpperCase()}`,
        filters: [{ name: format.toUpperCase(), extensions: [format] }],
        defaultPath: `keystill-${new Date().toISOString().slice(0, 10)}.${format}`,
      })
      if (choice.canceled || !choice.filePath) return null
      assertRevision(revision)
      const contents = exportPlaintext(requireDatabase().connection, requireUnlocked(), format)
      const path = choice.filePath.toLowerCase().endsWith(`.${format}`) ? choice.filePath : `${choice.filePath}.${format}`
      await writeExport(path, contents, revision)
      return basename(path)
    } catch { throw new Error('EXPORT_FAILED') }
    finally { vaultOperationBusy = false }
  })
  handleIpc('preview_import', async () => {
    requireUnlocked()
    if (vaultOperationBusy || !mainWindow) throw new Error('VAULT_BUSY')
    vaultOperationBusy = true
    pendingImport = null
    const revision = session.revision
    try {
      const choice = await dialog.showOpenDialog(mainWindow, {
        title: '导入 JSON / CSV', filters: [{ name: '凭证文件', extensions: ['json', 'csv'] }], properties: ['openFile'],
      })
      if (choice.canceled || !choice.filePaths[0]) return null
      assertRevision(revision)
      const path = choice.filePaths[0]
      const format = extname(path).slice(1).toLowerCase()
      assertTransferFormat(format)
      if ((await stat(path)).size > 64 * 1024 * 1024) throw new Error('INVALID_IMPORT')
      const contents = await readFile(path, 'utf8')
      assertRevision(revision)
      requireUnlocked()
      if (Buffer.byteLength(contents, 'utf8') > 64 * 1024 * 1024) throw new Error('INVALID_IMPORT')
      const records = parseImport(contents, format)
      const preview = previewImport(requireDatabase().connection, requireUnlocked(), records)
      const token = randomUUID()
      pendingImport = { token, revision, records }
      return { token, name: basename(path), ...preview }
    } catch { throw new Error('IMPORT_FAILED') }
    finally { vaultOperationBusy = false }
  })
  handleIpc('cancel_import', (_event, args: { token: string }) => {
    requireUnlocked()
    if (pendingImport?.token === args?.token) pendingImport = null
  })
  handleIpc('confirm_import', (_event, args: { token: string; skipDuplicates: boolean }) => {
    requireUnlocked()
    if (vaultOperationBusy) throw new Error('VAULT_BUSY')
    if (!pendingImport || pendingImport.token !== args?.token || typeof args.skipDuplicates !== 'boolean') throw new Error('IMPORT_EXPIRED')
    assertRevision(pendingImport.revision)
    const records = pendingImport.records
    pendingImport = null
    return importReviewed(requireDatabase().connection, requireUnlocked(), records, args.skipDuplicates)
  })

}

function registerBackupHandlers() {
  const filters = [{ name: 'Keystill 加密备份', extensions: ['jvault'] }]
  handleIpc('get_backup_status', () => { requireUnlocked(); return readBackupStatus(requireDatabase().connection) })
  handleIpc('get_automatic_backup_status', async () => {
    requireUnlocked()
    const revision = session.revision
    const status = await automaticBackupStatus(requireDatabase().connection)
    assertRevision(revision)
    return status
  })
  handleIpc('run_automatic_backup', async () => { requireUnlocked(); await automaticBackup(true) })
  handleIpc('configure_automatic_backup', async (_event, args: { enabled: boolean }) => {
    requireUnlocked()
    if (typeof args?.enabled !== 'boolean') throw new Error('INVALID_DATA')
    if (vaultOperationBusy || !mainWindow) throw new Error('VAULT_BUSY')
    vaultOperationBusy = true
    const revision = session.revision
    try {
      let path: string | null = null
      if (args.enabled) {
        const choice = await dialog.showOpenDialog(mainWindow, { title: '选择自动备份位置', properties: ['openDirectory', 'createDirectory'] })
        assertRevision(revision)
        if (choice.canceled || !choice.filePaths[0]) return
        path = join(choice.filePaths[0], `keystill-backups-${randomUUID()}`)
      }
      await setAutomaticBackupDirectory(requireDatabase().connection, path, () => { assertRevision(revision); requireUnlocked() })
    } finally { vaultOperationBusy = false }
    if (args.enabled) await automaticBackup(true)
  })
  handleIpc('list_recovery_snapshots', () => listRecoverySnapshots(app.getPath('userData')))
  handleIpc('create_backup', async () => {
    requireUnlocked()
    if (vaultOperationBusy || !mainWindow) throw new Error('VAULT_BUSY')
    vaultOperationBusy = true
    const revision = session.revision
    try {
      const choice = await dialog.showSaveDialog(mainWindow, {
        title: '保存加密备份', filters,
        defaultPath: `keystill-backup-${new Date().toISOString().slice(0, 10)}.jvault`,
      })
      if (choice.canceled || !choice.filePath) return null
      assertRevision(revision)
      const snapshotRevision = backupRevision(requireDatabase().connection)
      const contents = createBackup(requireDatabase().connection, readVaultMetadata()!, requireUnlocked())
      const path = choice.filePath.toLowerCase().endsWith('.jvault') ? choice.filePath : `${choice.filePath}.jvault`
      await writeExport(path, contents, revision)
      recordBackup(requireDatabase().connection, snapshotRevision)
      return basename(path)
    } catch (error) {
      if (error instanceof Error && error.message === 'BACKUP_TOO_LARGE') throw error
      throw new Error('BACKUP_WRITE_FAILED')
    } finally {
      vaultOperationBusy = false
    }
  })
  handleIpc('restore_backup', async (_event, args: { password: string; snapshotId?: string }) => {
    assertPassword(args?.password)
    if (vaultOperationBusy || !mainWindow) throw new Error('VAULT_BUSY')
    vaultOperationBusy = true
    const revision = session.revision
    try {
      let backup
      if (args.snapshotId !== undefined) {
        backup = await readRecoverySnapshot(app.getPath('userData'), args.snapshotId, args.password)
      } else {
        const choice = await dialog.showOpenDialog(mainWindow, { title: '选择加密备份', filters, properties: ['openFile'] })
        if (choice.canceled || !choice.filePaths[0]) return false
        const path = choice.filePaths[0]
        assertBackupSize((await stat(path)).size)
        backup = await readBackup(await readFile(path, 'utf8'), args.password)
      }
      assertRevision(revision)
      if (database && hasVault()) {
        const confirmation = await dialog.showMessageBox(mainWindow, {
          type: 'warning', title: '替换当前保险库',
          message: '恢复将替换当前全部凭证、项目、回收站和设置。',
          detail: '覆盖前将保留当前库的本机恢复快照，保存失败则停止恢复。恢复后使用所选备份或快照的主密码解锁。',
          buttons: ['取消', '替换并恢复'], defaultId: 0, cancelId: 0, noLink: true,
        })
        if (confirmation.response !== 1) return false
      }
      assertRevision(revision)
      if (database) {
        if (hasVault()) createRecoverySnapshot(database.connection, app.getPath('userData'))
        restoreBackup(database.connection, backup)
      }
      else {
        recoverDatabase(app.getPath('userData'), backup)
        initializeDatabase()
      }
      unlockLimiter.reset()
      settings = backup.settings
      session.lock()
      return true
    } catch (error) {
      if (error instanceof Error && ['BACKUP_TOO_LARGE', 'RECOVERY_SNAPSHOT_FAILED'].includes(error.message)) throw error
      throw new Error('BACKUP_RESTORE_FAILED')
    } finally { vaultOperationBusy = false }
  })
}

const primaryInstance = app.requestSingleInstanceLock()
if (!primaryInstance) app.quit()
else app.whenReady().then(() => {
  clipboardManager = new ClipboardManager(clipboard, () => settings.clipboardClearTimeout)
  session = new VaultSession(() => settings.autoLockMinutes, () => {
    pendingImport = null
    if (mainWindow && !mainWindow.webContents.isDestroyed()) mainWindow.webContents.send('vault_locked')
    void clipboardManager.clearOnLock().catch(() => {})
  })
  try { initializeDatabase() }
  catch { /* The unlock page exposes backup recovery without opening the damaged database. */ }
  powerMonitor.on('lock-screen', () => session.lock())
  powerMonitor.on('suspend', () => session.lock())
  powerMonitor.on('resume', () => { session.checkExpiry(); cleanTrash() })
  trashTimer = setInterval(cleanTrash, 60_000)
  trashTimer.unref()
  backupTimer = setInterval(() => { void automaticBackup() }, 60_000)
  backupTimer.unref()
  registerIpcHandlers()
  createWindow()
  desktop = createDesktopControls(() => mainWindow ?? createWindow(), () => session.lock())

  app.on('activate', () => {
    desktop.show()
  })
})

app.on('second-instance', () => { void app.whenReady().then(() => desktop.show()) })
app.on('window-all-closed', () => { /* The tray owns the application lifetime. */ })

let quitReady = false
let quitting = false
app.on('before-quit', (event) => {
  if (quitReady || !session) return
  event.preventDefault()
  if (quitting) return
  quitting = true
  clearInterval(trashTimer)
  clearInterval(backupTimer)
  session.dispose()
  void clipboardManager.clearOnLock().catch(() => {}).finally(() => {
    desktop?.dispose()
    database?.connection.close()
    database = null
    quitReady = true
    app.quit()
  })
})
