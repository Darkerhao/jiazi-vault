import { contextBridge, ipcRenderer } from 'electron'

const allowedCommands = new Set([
  'health_check',
  'get_desktop_status',
  'database_info',
  'get_vault_status',
  'create_vault',
  'unlock_vault',
  'lock_vault',
  'is_vault_unlocked',
  'create_item',
  'update_item',
  'delete_item',
  'restore_item',
  'get_item',
  'list_items',
  'toggle_favorite',
  'create_project',
  'update_project',
  'delete_project',
  'list_projects',
  'visit_project',
  'generate_password',
  'create_backup',
  'restore_backup',
  'export_plaintext',
  'import_plaintext',
  'get_settings',
  'update_settings',
  'copy_to_clipboard',
])

contextBridge.exposeInMainWorld('jiaziVault', {
  onItemsChanged(callback: () => void) {
    const listener = () => callback()
    ipcRenderer.on('items_changed', listener)
    return () => ipcRenderer.removeListener('items_changed', listener)
  },
  onDesktopAction(callback: (action: string) => void) {
    const listener = (_event: Electron.IpcRendererEvent, action: string) => callback(action)
    ipcRenderer.on('desktop_action', listener)
    return () => ipcRenderer.removeListener('desktop_action', listener)
  },
  onLocked(callback: () => void) {
    const listener = () => callback()
    ipcRenderer.on('vault_locked', listener)
    return () => ipcRenderer.removeListener('vault_locked', listener)
  },
  invoke(command: string, args?: unknown) {
    if (!allowedCommands.has(command)) {
      return Promise.reject(new Error('INVALID_COMMAND'))
    }
    return ipcRenderer.invoke(command, args)
  },
})
