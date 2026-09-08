import { join } from 'node:path'
import { app, BrowserWindow, ipcMain } from 'electron'
import { openDatabase, type DatabaseState } from './database.js'
import { clearKey, createVaultCredential, type VaultMetadata, unlockVaultCredential } from './vault-crypto.js'
import { createItemStore, type ItemInput, type VaultItem } from './item-store.js'

let mainWindow: BrowserWindow | null = null
let database: DatabaseState | null = null
let vaultUnlocked = false
let masterKey: Buffer | null = null

function requireDatabase() {
  if (!database) throw new Error('DATABASE_ERROR')
  return database
}

function readVaultMetadata(): VaultMetadata | null {
  const row = requireDatabase().connection.prepare('SELECT value FROM vault_metadata WHERE key = ?').get('vault') as { value?: string } | undefined
  if (!row?.value) return null
  try {
    return JSON.parse(row.value) as VaultMetadata
  } catch {
    throw new Error('DATABASE_ERROR')
  }
}

function assertPassword(password: unknown) {
  if (typeof password !== 'string' || password.length < 8) throw new Error('PASSWORD_TOO_SHORT')
}

function setMasterKey(key: Buffer | null) {
  clearKey(masterKey)
  masterKey = key
  vaultUnlocked = key !== null
}

function requireUnlocked(): Buffer {
  if (!vaultUnlocked || !masterKey) throw new Error('VAULT_LOCKED')
  return masterKey
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
  ipcMain.handle('get_vault_status', () => ({ exists: readVaultMetadata() !== null, unlocked: vaultUnlocked }))
  ipcMain.handle('is_vault_unlocked', () => vaultUnlocked)
  ipcMain.handle('lock_vault', () => {
    setMasterKey(null)
  })
  ipcMain.handle('create_vault', async (_event, args: { password: string }) => {
    assertPassword(args?.password)
    if (readVaultMetadata()) throw new Error('VAULT_EXISTS')

    const credential = await createVaultCredential(args.password)
    try {
      requireDatabase().connection.prepare('INSERT INTO vault_metadata (key, value) VALUES (?, ?)').run('vault', JSON.stringify(credential.metadata))
      setMasterKey(credential.masterKey)
    } catch (error) {
      clearKey(credential.masterKey)
      throw error
    }
  })
  ipcMain.handle('unlock_vault', async (_event, args: { password: string }) => {
    assertPassword(args?.password)
    const metadata = readVaultMetadata()
    if (!metadata) throw new Error('VAULT_NOT_FOUND')
    const key = await unlockVaultCredential(args.password, metadata)
    setMasterKey(key)
    return { unlocked: key !== null }
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
}

app.whenReady().then(() => {
  database = openDatabase(app.getPath('userData'))
  registerIpcHandlers()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  setMasterKey(null)
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  setMasterKey(null)
  database?.connection.close()
  database = null
})
