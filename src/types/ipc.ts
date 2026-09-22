import type { Project, ProjectInput, VaultItem, VaultItemSummary } from './vault'
import type { AppSettings } from '../../electron/settings'
import type { GeneratedPassword, PasswordOptions } from '../../electron/password-generator'
import type { DesktopAction } from '../../electron/desktop'
import type { TransferFormat } from '../../electron/contracts'

export type VaultError =
  | 'INVALID_PASSWORD'
  | 'PASSWORD_TOO_SHORT'
  | 'VAULT_EXISTS'
  | 'VAULT_NOT_FOUND'
  | 'VAULT_LOCKED'
  | 'DECRYPT_FAILED'
  | 'DATABASE_ERROR'
  | 'INVALID_DATA'
  | 'BACKUP_ERROR'
  | 'PERMISSION_DENIED'

export interface UnlockResult {
  unlocked: boolean
  retryAt: number
}

export interface VaultStatus {
  exists: boolean
  unlocked: boolean
  retryAt: number
}

export interface IpcCommands {
  health_check: { args: undefined; result: string }
  get_desktop_status: { args: undefined; result: { shortcut: string; shortcutRegistered: boolean } }
  database_info: { args: undefined; result: { initialized: boolean; path: string } }
  get_vault_status: { args: undefined; result: VaultStatus }
  create_vault: { args: { password: string }; result: void }
  unlock_vault: { args: { password: string }; result: UnlockResult }
  lock_vault: { args: undefined; result: void }
  is_vault_unlocked: { args: undefined; result: boolean }
  create_item: { args: { item: Omit<VaultItem, 'id' | 'createdAt' | 'updatedAt'> }; result: VaultItemSummary }
  update_item: { args: { item: VaultItem }; result: VaultItemSummary }
  delete_item: { args: { id: string; permanently?: boolean }; result: void }
  restore_item: { args: { id: string }; result: void }
  get_item: { args: { id: string; recordAccess?: boolean }; result: VaultItem | null }
  list_items: { args: { trashed?: boolean }; result: VaultItemSummary[] }
  toggle_favorite: { args: { id: string }; result: VaultItemSummary }
  create_project: { args: { project: ProjectInput }; result: Project }
  update_project: { args: { project: ProjectInput & { id: string } }; result: Project }
  visit_project: { args: { id: string }; result: Project }
  delete_project: { args: { id: string }; result: void }
  list_projects: { args: undefined; result: Project[] }
  generate_password: { args: PasswordOptions; result: GeneratedPassword }
  get_settings: { args: undefined; result: AppSettings }
  update_settings: { args: { settings: AppSettings }; result: AppSettings }
  copy_to_clipboard: { args: { text: string; itemId?: string }; result: number | null }
  create_backup: { args: undefined; result: string | null }
  restore_backup: { args: { password: string }; result: boolean }
  export_plaintext: { args: { format: TransferFormat }; result: string | null }
  import_plaintext: { args: undefined; result: number | null }
}

export interface DesktopBridge {
  onItemsChanged(callback: () => void): () => void
  onDesktopAction(callback: (action: DesktopAction) => void): () => void
  onLocked(callback: () => void): () => void
  invoke<K extends keyof IpcCommands>(
    command: K,
    args: IpcCommands[K]['args'],
  ): Promise<IpcCommands[K]['result']>
}
