import { join } from 'node:path'
import { app, BrowserWindow, ipcMain } from 'electron'
import { openDatabase, type DatabaseState } from './database.js'

let mainWindow: BrowserWindow | null = null
let database: DatabaseState | null = null
let vaultUnlocked = false

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
    if (!database) throw new Error('DATABASE_ERROR')
    database.connection.prepare('SELECT 1').get()
    return { initialized: true, path: database.path }
  })
  ipcMain.handle('is_vault_unlocked', () => vaultUnlocked)
  ipcMain.handle('lock_vault', () => {
    vaultUnlocked = false
  })
  ipcMain.handle('unlock_vault', () => ({ unlocked: false }))
  ipcMain.handle('list_items', () => [])
  ipcMain.handle('list_projects', () => [])
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
  database?.connection.close()
  database = null
  if (process.platform !== 'darwin') app.quit()
})
