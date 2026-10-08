// Shared test setup for the production select -> verify -> confirm restore contract.
export async function restoreFromBackup(call, { password, snapshotId }) {
  const source = await call('select_backup_source', { snapshotId })
  if (!source) return false
  const preview = await call('preview_backup', { token: source.token, password })
  return call('restore_backup', { token: preview.token })
}
