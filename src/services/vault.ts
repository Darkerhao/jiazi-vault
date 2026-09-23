import { callCommand } from './ipc'
import type { VaultItem, VaultItemSummary } from '../types/vault'

export const vaultService = {
  create: (password: string) => callCommand('create_vault', { password }),
  unlock: (password: string) => callCommand('unlock_vault', { password }),
  biometricStatus: () => callCommand('get_biometric_status'),
  enableBiometric: (password: string) => callCommand('enable_biometric', { password }),
  disableBiometric: () => callCommand('disable_biometric'),
  unlockBiometric: () => callCommand('unlock_biometric'),
  changePassword: (currentPassword: string, newPassword: string) => callCommand('change_master_password', { currentPassword, newPassword }),
  status: () => callCommand('get_vault_status'),
  lock: () => callCommand('lock_vault'),
  isUnlocked: () => callCommand('is_vault_unlocked'),
  listItems: (trashed = false) => callCommand('list_items', { trashed }),
  getItem: (id: string, recordAccess = true) => callCommand('get_item', { id, recordAccess }),
  createItem: (item: Omit<VaultItem, 'id' | 'createdAt' | 'updatedAt'>) => callCommand('create_item', { item }),
  updateItem: (item: VaultItem) => callCommand('update_item', { item }),
  deleteItem: (id: string, permanently = false) => callCommand('delete_item', { id, permanently }),
  restoreItem: (id: string) => callCommand('restore_item', { id }),
  toggleFavorite: (id: string): Promise<VaultItemSummary> => callCommand('toggle_favorite', { id }),
}
