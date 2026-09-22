import { callCommand } from './ipc'

export const clipboardService = {
  copy: (text: string) => callCommand('copy_to_clipboard', { text }),
}
