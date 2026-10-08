import { callCommand } from './ipc'

export const backupService = {
  create: () => callCommand('create_backup'),
  restore: (token: string) => callCommand('restore_backup', { token }),
}
