import { contextBridge, ipcRenderer } from 'electron'

const allowedCommands = new Set([
  'health_check',
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
  'search_items',
  'toggle_favorite',
  'create_project',
  'update_project',
  'delete_project',
  'list_projects',
  'generate_password',
  'export_vault',
  'import_vault',
  'create_backup',
  'restore_backup',
])

contextBridge.exposeInMainWorld('jiaziVault', {
  invoke(command: string, args?: unknown) {
    if (!allowedCommands.has(command)) {
      return Promise.reject(new Error('INVALID_COMMAND'))
    }
    return ipcRenderer.invoke(command, args)
  },
})
