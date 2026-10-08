import { contextBridge, ipcRenderer } from 'electron'

const allowedCommands = new Set([
  'health_check',
  'get_app_version',
  'check_for_updates',
  'open_release_page',
  'get_desktop_status',
  'set_search_shortcut',
  'database_info',
  'get_vault_status',
  'create_vault',
  'unlock_vault',
  'get_biometric_status',
  'enable_biometric',
  'disable_biometric',
  'unlock_biometric',
  'change_master_password',
  'lock_vault',
  'is_vault_unlocked',
  'create_item',
  'update_item',
  'batch_items',
  'list_item_history',
  'get_item_history',
  'restore_item_history',
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
  'get_backup_status',
  'create_backup',
  'restore_backup',
  'select_backup_source',
  'preview_backup',
  'cancel_backup_restore',
  'get_automatic_backup_status',
  'configure_automatic_backup',
  'run_automatic_backup',
  'list_recovery_snapshots',
  'export_plaintext',
  'preview_import',
  'confirm_import',
  'cancel_import',
  'read_env_file',
  'export_env',
  'get_settings',
  'update_settings',
  'copy_to_clipboard',
])

contextBridge.exposeInMainWorld('jiaziVault', {
  onBackupChanged(callback: () => void) {
    const listener = () => callback()
    ipcRenderer.on('backup_changed', listener)
    return () => ipcRenderer.removeListener('backup_changed', listener)
  },
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
