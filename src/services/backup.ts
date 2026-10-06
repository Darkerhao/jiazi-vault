import { callCommand } from './ipc'

export const backupService = {
  create: () => callCommand('create_backup'),
  restore: (password: string, snapshotId?: string) => callCommand('restore_backup', { password, snapshotId }),
}
