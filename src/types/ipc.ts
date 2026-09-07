import type { Environment, ItemType, Project, VaultItem, VaultItemSummary } from './vault'

export type VaultError =
  | 'INVALID_PASSWORD'
  | 'VAULT_NOT_FOUND'
  | 'VAULT_LOCKED'
  | 'DECRYPT_FAILED'
  | 'DATABASE_ERROR'
  | 'INVALID_DATA'
  | 'BACKUP_ERROR'
  | 'PERMISSION_DENIED'

export interface UnlockResult {
  unlocked: boolean
}

export interface SearchItemsRequest {
  query: string
  type?: ItemType
  environment?: Environment
  projectId?: string
}

export interface IpcCommands {
  health_check: { args: undefined; result: string }
  database_info: { args: undefined; result: { initialized: boolean; path: string } }
  create_vault: { args: { password: string }; result: void }
  unlock_vault: { args: { password: string }; result: UnlockResult }
  lock_vault: { args: undefined; result: void }
  is_vault_unlocked: { args: undefined; result: boolean }
  create_item: { args: { item: Omit<VaultItem, 'id' | 'createdAt' | 'updatedAt'> }; result: VaultItemSummary }
  update_item: { args: { item: VaultItem }; result: VaultItemSummary }
  delete_item: { args: { id: string; permanently?: boolean }; result: void }
  restore_item: { args: { id: string }; result: void }
  get_item: { args: { id: string }; result: VaultItem }
  list_items: { args: undefined; result: VaultItemSummary[] }
  search_items: { args: SearchItemsRequest; result: VaultItemSummary[] }
  toggle_favorite: { args: { id: string }; result: VaultItemSummary }
  create_project: { args: { project: Omit<Project, 'id' | 'itemCount'> }; result: Project }
  update_project: { args: { project: Project }; result: Project }
  delete_project: { args: { id: string }; result: void }
  list_projects: { args: undefined; result: Project[] }
  generate_password: { args: { length: number; uppercase: boolean; lowercase: boolean; numbers: boolean; symbols: boolean; excludeAmbiguous: boolean }; result: string }
  export_vault: { args: { format: 'jvault' | 'json' | 'csv' }; result: string }
  import_vault: { args: { path: string }; result: void }
  create_backup: { args: undefined; result: string }
  restore_backup: { args: { path: string }; result: void }
}

export interface DesktopBridge {
  invoke<K extends keyof IpcCommands>(
    command: K,
    args: IpcCommands[K]['args'],
  ): Promise<IpcCommands[K]['result']>
}
