import type { ImportPreview, ItemHistorySummary, AutomaticBackupStatus, RecoverySnapshot, ItemBatchAction, ExportScope, BackupSource, BackupPreview } from '../../electron/contracts'
import type { BackupStatus } from '../../electron/backup-status'
import type { UpdateState } from '../../electron/app-update'
import type { Project, ProjectInput, VaultItem, VaultItemSummary } from './vault'
import type { AppSettings } from '../../electron/settings'
import type { GeneratedPassword, PasswordOptions } from '../../electron/password-generator'
import type { DesktopAction } from '../../electron/desktop'
import type { TransferFormat, BiometricStatus } from '../../electron/contracts'

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
  databaseError: boolean
}

export interface IpcCommands {
  health_check: { args: undefined; result: string }
  get_app_version: { args: undefined; result: string }
  get_update_state: { args: undefined; result: UpdateState }
  check_for_updates: { args: undefined; result: UpdateState }
  open_release_page: { args: undefined; result: void }
  get_desktop_status: { args: undefined; result: { shortcut: string | null; shortcutRegistered: boolean } }
  set_search_shortcut: { args: { shortcut: string | null }; result: { shortcut: string | null; shortcutRegistered: boolean } }
  database_info: { args: undefined; result: { initialized: boolean; path: string } }
  get_vault_status: { args: undefined; result: VaultStatus }
  create_vault: { args: { password: string }; result: void }
  unlock_vault: { args: { password: string }; result: UnlockResult }
  get_biometric_status: { args: undefined; result: BiometricStatus }
  enable_biometric: { args: { password: string }; result: void }
  disable_biometric: { args: undefined; result: void }
  unlock_biometric: { args: undefined; result: void }
  change_master_password: { args: { currentPassword: string; newPassword: string }; result: void }
  lock_vault: { args: undefined; result: void }
  is_vault_unlocked: { args: undefined; result: boolean }
  create_item: { args: { item: Omit<VaultItem, 'id' | 'createdAt' | 'updatedAt'> }; result: VaultItemSummary }
  update_item: { args: { item: VaultItem }; result: VaultItemSummary }
  batch_items: { args: { ids: string[]; action: ItemBatchAction }; result: number }
  list_item_history: { args: { id: string }; result: ItemHistorySummary[] }
  get_item_history: { args: { id: string; historyId: number }; result: VaultItem }
  restore_item_history: { args: { id: string; historyId: number }; result: VaultItemSummary }
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
  get_backup_status: { args: undefined; result: BackupStatus }
  create_backup: { args: undefined; result: string | null }
  select_backup_source: { args: { snapshotId?: string }; result: BackupSource | null }
  preview_backup: { args: { token: string; password: string }; result: BackupPreview }
  cancel_backup_restore: { args: { token: string }; result: void }
  restore_backup: { args: { token: string }; result: boolean }
  get_automatic_backup_status: { args: undefined; result: AutomaticBackupStatus }
  configure_automatic_backup: { args: { enabled: boolean }; result: void }
  run_automatic_backup: { args: undefined; result: void }
  list_recovery_snapshots: { args: undefined; result: RecoverySnapshot[] }
  export_plaintext: { args: { format: TransferFormat; scope?: ExportScope }; result: string | null }
  preview_import: { args: undefined; result: ImportPreview | null }
  confirm_import: { args: { token: string; skipDuplicates: boolean }; result: number }
  cancel_import: { args: { token: string }; result: void }
  read_env_file: { args: undefined; result: { name: string; contents: string } | null }
  export_env: { args: { fields: Record<string, string>; destination: 'clipboard' | 'file'; itemId?: string }; result: { name: string; usedAt: number | null } | null }
}

export interface DesktopBridge {
  onUpdateState(callback: (state: UpdateState) => void): () => void
  onBackupChanged(callback: () => void): () => void
  onItemsChanged(callback: () => void): () => void
  onDesktopAction(callback: (action: DesktopAction) => void): () => void
  onLocked(callback: () => void): () => void
  invoke<K extends keyof IpcCommands>(
    command: K,
    args: IpcCommands[K]['args'],
  ): Promise<IpcCommands[K]['result']>
}
