import { join } from 'node:path'
import { app, globalShortcut, Menu, nativeImage, Tray, type BrowserWindow } from 'electron'

export type DesktopAction = 'open' | 'quick-search' | 'generator' | 'new-item' | 'new-project'

export function createDesktopControls(getWindow: () => BrowserWindow, lock: () => void) {
  const icon = nativeImage.createFromPath(join(app.getAppPath(), app.isPackaged ? 'dist' : 'public', 'tray.png'))
  if (process.platform === 'darwin') icon.setTemplateImage(true)
  const tray = new Tray(icon.resize({ width: 20, height: 20 }))
  tray.setToolTip('Jiazi Vault')

  function show(action: DesktopAction = 'open') {
    const window = getWindow()
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
    if (action === 'open') return
    const send = () => window.webContents.send('desktop_action', action)
    if (window.webContents.isLoadingMainFrame()) window.webContents.once('did-finish-load', send)
    else send()
  }

  const menu = Menu.buildFromTemplate([
    { label: 'Jiazi Vault', enabled: false },
    { type: 'separator' },
    { label: '打开保险库', click: () => show() },
    { label: '快捷搜索', click: () => show('quick-search') },
    { label: '生成密码', click: () => show('generator') },
    { label: '锁定保险库', click: lock },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() },
  ])
  tray.setContextMenu(menu)
  tray.on('double-click', () => show())
  const shortcut = 'CommandOrControl+Shift+P'
  const shortcutRegistered = globalShortcut.register(shortcut, () => show('quick-search'))
  return {
    show,
    status: { shortcut: process.platform === 'darwin' ? '⌘ Shift P' : 'Ctrl + Shift + P', shortcutRegistered },
    dispose() { globalShortcut.unregisterAll(); tray.destroy() },
  }
}
