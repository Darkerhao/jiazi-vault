import { callCommand } from './ipc'

export const clipboardService = {
  copy: (text: string, itemId?: string) => callCommand('copy_to_clipboard', { text, itemId }),
  copyItem: (id: string) => callCommand('copy_item', { id }),
  copyEnv: (fields: Record<string, string>, itemId: string) => callCommand('export_env', { fields, destination: 'clipboard', itemId }),
}
