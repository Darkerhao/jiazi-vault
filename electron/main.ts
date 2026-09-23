import { basename, extname, join } from 'node:path'
import { readFile, stat, writeFile, rename, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { app, BrowserWindow, clipboard, dialog, ipcMain, powerMonitor } from 'electron'
import { openDatabase, purgeExpiredItems, type DatabaseState } from './database.js'
import { clearKey, createVaultCredential, isVaultMetadata, type CreatedVaultCredential, type VaultMetadata, unlockVaultCredential } from './vault-crypto.js'
import { createItemStore, type ItemInput, type VaultItem } from './item-store.js'
import { readSettings, writeSettings, type AppSettings } from './settings.js'
import { VaultSession } from './vault-session.js'
import { ClipboardManager } from './clipboard-manager.js'
import { createBackup, readBackup, restoreBackup } from './backup.js'
import { UnlockLimiter } from './unlock-limiter.js'
import { createProjectStore, type ProjectInput } from './project-store.js'
import { generatePassword, type PasswordOptions } from './password-generator.js'
import { createDesktopControls } from './desktop.js'
import { assertTransferFormat, exportPlaintext, importPlaintext, readPlaintext, type TransferFormat } from './transfer.js'
import { replaceVaultPassword } from './vault-password.js'
import { BiometricVault } from './biometric-vault.js'
import { createBiometricProvider } from './biometric-provider.js'
import { ENV_MAX_BYTES, serializeEnv, validateEnvFields } from './env.js'

let mainWindow: BrowserWindow | null = null
let database: DatabaseState | null = null
let settings: AppSettings
let session: VaultSession
let clipboardManager: ClipboardManager
let vaultOperationBusy = false
let unlockLimiter: UnlockLimiter
let desktop: ReturnType<typeof createDesktopControls>
let trashTimer: ReturnType<typeof setInterval> | undefined
let biometric: BiometricVault

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
    title: 'Jiazi Vault',
    icon: join(app.getAppPath(), app.isPackaged ? 'dist' : 'public', 'brand', 'icon.png'),
    width: 1200,
    height: 760,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#181a1f',
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
  ipcMain.handle('health_check', () => 'ok')
  ipcMain.handle('get_desktop_status', () => desktop.status)
  ipcMain.handle('database_info', () => {
    const currentDatabase = requireDatabase()
    currentDatabase.connection.prepare('SELECT 1').get()
    return { initialized: true, path: currentDatabase.path }
  })
  ipcMain.handle('get_vault_status', () => ({ exists: hasVault(), unlocked: session.unlocked, retryAt: unlockLimiter.retryAt }))
  ipcMain.handle('is_vault_unlocked', () => session.unlocked)
  ipcMain.handle('lock_vault', () => session.lock())
  ipcMain.handle('get_settings', () => settings)
  ipcMain.handle('update_settings', (_event, args: { settings: AppSettings }) => {
    requireUnlocked()
    settings = writeSettings(requireDatabase().connection, args?.settings)
    session.checkExpiry()
    clipboardManager.reschedule()
    return settings
  })
  const itemStore = createItemStore(requireDatabase().connection, () => requireUnlocked())
  ipcMain.handle('copy_to_clipboard', async (_event, args: { text: string; itemId?: string }) => {
    requireUnlocked()
    if (typeof args?.text !== 'string') throw new Error('INVALID_DATA')
    const revision = session.revision
    await clipboardManager.copy(args.text, () => { assertRevision(revision); requireUnlocked() })
    assertRevision(revision)
    return args.itemId ? itemStore.markUsed(args.itemId) : null
  })
  ipcMain.handle('generate_password', (_event, args: PasswordOptions) => {
    requireUnlocked()
    return generatePassword(args)
  })
  ipcMain.handle('create_vault', async (_event, args: { password: string }) => {
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
  ipcMain.handle('unlock_vault', async (_event, args: { password: string }) => {
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
  ipcMain.handle('get_biometric_status', () => biometric.status())
  ipcMain.handle('enable_biometric', async (_event, args: { password: string }) => {
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
  ipcMain.handle('disable_biometric', () => {
    requireUnlocked()
    if (vaultOperationBusy) throw new Error('VAULT_BUSY')
    biometric.disable()
  })
  ipcMain.handle('unlock_biometric', async () => {
    if (vaultOperationBusy) throw new Error('VAULT_BUSY')
    const metadata = readVaultMetadata()
    if (!metadata) throw new Error('VAULT_NOT_FOUND')
    vaultOperationBusy = true
    try {
      await session.authenticate(() => biometric.unlock(metadata), () => unlockLimiter.reset())
    } finally { vaultOperationBusy = false }
  })
  ipcMain.handle('change_master_password', async (_event, args: { currentPassword: string; newPassword: string }) => {
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
  ipcMain.handle('list_items', (_event, args?: { trashed?: boolean }) => {
    requireUnlocked()
    cleanTrash()
    return itemStore.list(args?.trashed ?? false)
  })
  ipcMain.handle('get_item', (_event, args: { id: string; recordAccess?: boolean }) => {
    requireUnlocked()
    cleanTrash()
    return itemStore.get(args?.id, args?.recordAccess !== false)
  })
  ipcMain.handle('create_item', (_event, args: { item: ItemInput }) => {
    requireUnlocked()
    return itemStore.create(args?.item)
  })
  ipcMain.handle('update_item', (_event, args: { item: VaultItem }) => {
    requireUnlocked()
    return itemStore.update(args?.item)
  })
  ipcMain.handle('toggle_favorite', (_event, args: { id: string }) => {
    requireUnlocked()
    return itemStore.toggleFavorite(args?.id)
  })
  ipcMain.handle('delete_item', (_event, args: { id: string; permanently?: boolean }) => {
    requireUnlocked()
    itemStore.remove(args?.id, args?.permanently)
  })
  ipcMain.handle('restore_item', (_event, args: { id: string }) => {
    requireUnlocked()
    cleanTrash()
    if (!itemStore.get(args?.id)) throw new Error('ITEM_NOT_FOUND')
    itemStore.restore(args?.id)
  })
  const projects = createProjectStore(requireDatabase().connection)
  ipcMain.handle('list_projects', () => {
    requireUnlocked()
    return projects.list()
  })
  ipcMain.handle('create_project', (_event, args: { project: ProjectInput }) => {
    requireUnlocked()
    return projects.create(args?.project)
  })
  ipcMain.handle('update_project', (_event, args: { project: ProjectInput & { id: string } }) => {
    requireUnlocked()
    return projects.update(args?.project)
  })
  ipcMain.handle('delete_project', (_event, args: { id: string }) => {
    requireUnlocked()
    projects.remove(args?.id)
  })
  ipcMain.handle('visit_project', (_event, args: { id: string }) => {
    requireUnlocked()
    return projects.visit(args?.id)
  })
  registerBackupHandlers()
  registerTransferHandlers()
  registerEnvHandlers(itemStore)
}

function registerEnvHandlers(itemStore: ReturnType<typeof createItemStore>) {
  ipcMain.handle('read_env_file', async () => {
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
  ipcMain.handle('export_env', async (_event, args: { fields: Record<string, string>; destination: 'clipboard' | 'file'; itemId?: string }) => {
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
  const temporaryPath = `${path}.${randomUUID()}.tmp`
  try {
    await writeFile(temporaryPath, contents, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    assertRevision(revision)
    requireUnlocked()
    await rename(temporaryPath, path)
  } finally { await rm(temporaryPath, { force: true }).catch(() => {}) }
}

function registerTransferHandlers() {
  ipcMain.handle('export_plaintext', async (_event, args: { format: TransferFormat }) => {
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
        defaultPath: `jiazi-vault-${new Date().toISOString().slice(0, 10)}.${format}`,
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
  ipcMain.handle('import_plaintext', async () => {
    requireUnlocked()
    if (vaultOperationBusy || !mainWindow) throw new Error('VAULT_BUSY')
    vaultOperationBusy = true
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
      const items = readPlaintext(contents, format)
      if (!items.length) return 0
      const confirmation = await dialog.showMessageBox(mainWindow, {
        type: 'question', title: '追加导入凭证', message: `将新增 ${items.length} 条凭证。`,
        detail: '现有凭证不会被覆盖；重复导入会生成新条目。项目按名称关联，不存在的项目会自动创建。',
        buttons: ['取消', '确认导入'], defaultId: 0, cancelId: 0, noLink: true,
      })
      if (confirmation.response !== 1) return null
      assertRevision(revision)
      return importPlaintext(requireDatabase().connection, requireUnlocked(), items)
    } catch { throw new Error('IMPORT_FAILED') }
    finally { vaultOperationBusy = false }
  })
}

function registerBackupHandlers() {
  const filters = [{ name: 'Jiazi Vault 加密备份', extensions: ['jvault'] }]
  ipcMain.handle('create_backup', async () => {
    requireUnlocked()
    if (vaultOperationBusy || !mainWindow) throw new Error('VAULT_BUSY')
    vaultOperationBusy = true
    const revision = session.revision
    try {
      const choice = await dialog.showSaveDialog(mainWindow, {
        title: '保存加密备份', filters,
        defaultPath: `jiazi-vault-backup-${new Date().toISOString().slice(0, 10)}.jvault`,
      })
      if (choice.canceled || !choice.filePath) return null
      assertRevision(revision)
      const contents = createBackup(requireDatabase().connection, readVaultMetadata()!, requireUnlocked())
      const path = choice.filePath.toLowerCase().endsWith('.jvault') ? choice.filePath : `${choice.filePath}.jvault`
      await writeExport(path, contents, revision)
      return basename(path)
    } catch {
      throw new Error('BACKUP_WRITE_FAILED')
    } finally {
      vaultOperationBusy = false
    }
  })
  ipcMain.handle('restore_backup', async (_event, args: { password: string }) => {
    assertPassword(args?.password)
    if (vaultOperationBusy || !mainWindow) throw new Error('VAULT_BUSY')
    vaultOperationBusy = true
    const revision = session.revision
    try {
      const choice = await dialog.showOpenDialog(mainWindow, { title: '选择加密备份', filters, properties: ['openFile'] })
      if (choice.canceled || !choice.filePaths[0]) return false
      const path = choice.filePaths[0]
      if ((await stat(path)).size > 64 * 1024 * 1024) throw new Error('INVALID_BACKUP')
      const backup = await readBackup(await readFile(path, 'utf8'), args.password)
      assertRevision(revision)
      if (hasVault()) {
        const confirmation = await dialog.showMessageBox(mainWindow, {
          type: 'warning', title: '替换当前保险库',
          message: '恢复将替换当前全部凭证、项目、回收站和设置。',
          detail: '此操作无法撤销。请确认已保存当前保险库的备份。恢复后使用备份的主密码解锁。',
          buttons: ['取消', '替换并恢复'], defaultId: 0, cancelId: 0, noLink: true,
        })
        if (confirmation.response !== 1) return false
      }
      assertRevision(revision)
      restoreBackup(requireDatabase().connection, backup)
      unlockLimiter.reset()
      settings = backup.settings
      session.lock()
      return true
    } catch {
      throw new Error('BACKUP_RESTORE_FAILED')
    } finally { vaultOperationBusy = false }
  })
}

const primaryInstance = app.requestSingleInstanceLock()
if (!primaryInstance) app.quit()
else app.whenReady().then(() => {
  database = openDatabase(app.getPath('userData'))
  unlockLimiter = new UnlockLimiter(database.connection)
  settings = readSettings(database.connection)
  clipboardManager = new ClipboardManager(clipboard, () => settings.clipboardClearTimeout)
  session = new VaultSession(() => settings.autoLockMinutes, () => {
    if (mainWindow && !mainWindow.webContents.isDestroyed()) mainWindow.webContents.send('vault_locked')
    void clipboardManager.clearOnLock().catch(() => {})
  })
  biometric = new BiometricVault(database.connection, createBiometricProvider(() => mainWindow))
  powerMonitor.on('lock-screen', () => session.lock())
  powerMonitor.on('suspend', () => session.lock())
  powerMonitor.on('resume', () => { session.checkExpiry(); cleanTrash() })
  trashTimer = setInterval(cleanTrash, 60_000)
  trashTimer.unref()
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
  session.dispose()
  void clipboardManager.clearOnLock().catch(() => {}).finally(() => {
    desktop?.dispose()
    database?.connection.close()
    database = null
    quitReady = true
    app.quit()
  })
})
