import { basename, join } from 'node:path'
import { readFile, stat, writeFile, rename, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { app, BrowserWindow, clipboard, dialog, ipcMain, powerMonitor } from 'electron'
import { openDatabase, type DatabaseState } from './database.js'
import { createVaultCredential, isVaultMetadata, type VaultMetadata, unlockVaultCredential } from './vault-crypto.js'
import { createItemStore, type ItemInput, type VaultItem } from './item-store.js'
import { readSettings, writeSettings, type AppSettings } from './settings.js'
import { VaultSession } from './vault-session.js'
import { ClipboardManager } from './clipboard-manager.js'
import { createBackup, readBackup, restoreBackup } from './backup.js'

let mainWindow: BrowserWindow | null = null
let database: DatabaseState | null = null
let settings: AppSettings
let session: VaultSession
let clipboardManager: ClipboardManager
let backupBusy = false

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
  mainWindow.on('close', () => session.lock())
  mainWindow.on('closed', () => { mainWindow = null })

  if (app.isPackaged) {
    void mainWindow.loadFile(join(app.getAppPath(), 'dist', 'index.html'))
  } else {
    void mainWindow.loadURL('http://127.0.0.1:1420')
  }
}

function registerIpcHandlers() {
  ipcMain.handle('health_check', () => 'ok')
  ipcMain.handle('database_info', () => {
    const currentDatabase = requireDatabase()
    currentDatabase.connection.prepare('SELECT 1').get()
    return { initialized: true, path: currentDatabase.path }
  })
  ipcMain.handle('get_vault_status', () => ({ exists: hasVault(), unlocked: session.unlocked }))
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
  ipcMain.handle('copy_to_clipboard', (_event, args: { text: string }) => {
    requireUnlocked()
    if (typeof args?.text !== 'string' || !args.text) throw new Error('INVALID_DATA')
    const revision = session.revision
    return clipboardManager.copy(args.text, () => { assertRevision(revision); requireUnlocked() })
  })
  ipcMain.handle('create_vault', async (_event, args: { password: string }) => {
    if (backupBusy) throw new Error('VAULT_BUSY')
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
    if (backupBusy) throw new Error('VAULT_BUSY')
    assertPassword(args?.password)
    const metadata = readVaultMetadata()
    if (!metadata) throw new Error('VAULT_NOT_FOUND')
    return { unlocked: await session.authenticate(() => unlockVaultCredential(args.password, metadata)) }
  })
  const itemStore = createItemStore(requireDatabase().connection, () => requireUnlocked())

  ipcMain.handle('list_items', (_event, args?: { trashed?: boolean }) => {
    requireUnlocked()
    return itemStore.list(args?.trashed ?? false)
  })
  ipcMain.handle('get_item', (_event, args: { id: string }) => {
    requireUnlocked()
    return itemStore.get(args?.id)
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
    itemStore.restore(args?.id)
  })
  ipcMain.handle('list_projects', () => {
    requireUnlocked()
    return []
  })
  registerBackupHandlers()
}

function registerBackupHandlers() {
  const filters = [{ name: 'Jiazi Vault 加密备份', extensions: ['jvault'] }]
  ipcMain.handle('create_backup', async () => {
    requireUnlocked()
    if (backupBusy || !mainWindow) throw new Error('VAULT_BUSY')
    backupBusy = true
    const revision = session.revision
    let temporaryPath: string | undefined
    try {
      const choice = await dialog.showSaveDialog(mainWindow, {
        title: '保存加密备份', filters,
        defaultPath: `jiazi-vault-backup-${new Date().toISOString().slice(0, 10)}.jvault`,
      })
      if (choice.canceled || !choice.filePath) return null
      assertRevision(revision)
      const contents = createBackup(requireDatabase().connection, readVaultMetadata()!, requireUnlocked())
      const path = choice.filePath.toLowerCase().endsWith('.jvault') ? choice.filePath : `${choice.filePath}.jvault`
      temporaryPath = `${path}.${randomUUID()}.tmp`
      await writeFile(temporaryPath, contents, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
      await rename(temporaryPath, path)
      return basename(path)
    } catch {
      throw new Error('BACKUP_WRITE_FAILED')
    } finally {
      if (temporaryPath) await rm(temporaryPath, { force: true }).catch(() => {})
      backupBusy = false
    }
  })
  ipcMain.handle('restore_backup', async (_event, args: { password: string }) => {
    assertPassword(args?.password)
    if (backupBusy || !mainWindow) throw new Error('VAULT_BUSY')
    backupBusy = true
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
          message: '恢复将替换当前全部凭证、回收站和设置。',
          detail: '此操作无法撤销。请确认已保存当前保险库的备份。恢复后使用备份的主密码解锁。',
          buttons: ['取消', '替换并恢复'], defaultId: 0, cancelId: 0, noLink: true,
        })
        if (confirmation.response !== 1) return false
      }
      assertRevision(revision)
      restoreBackup(requireDatabase().connection, backup)
      settings = backup.settings
      session.lock()
      return true
    } catch {
      throw new Error('BACKUP_RESTORE_FAILED')
    } finally { backupBusy = false }
  })
}

app.whenReady().then(() => {
  database = openDatabase(app.getPath('userData'))
  settings = readSettings(database.connection)
  clipboardManager = new ClipboardManager(clipboard, () => settings.clipboardClearTimeout)
  session = new VaultSession(() => settings.autoLockMinutes, () => {
    if (mainWindow && !mainWindow.webContents.isDestroyed()) mainWindow.webContents.send('vault_locked')
    void clipboardManager.clearOnLock().catch(() => {})
  })
  powerMonitor.on('lock-screen', () => session.lock())
  powerMonitor.on('suspend', () => session.lock())
  powerMonitor.on('resume', () => session.checkExpiry())
  registerIpcHandlers()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

let quitReady = false
let quitting = false
app.on('before-quit', (event) => {
  if (quitReady || !session) return
  event.preventDefault()
  if (quitting) return
  quitting = true
  session.dispose()
  void clipboardManager.clearOnLock().catch(() => {}).finally(() => {
    database?.connection.close()
    database = null
    quitReady = true
    app.quit()
  })
})
