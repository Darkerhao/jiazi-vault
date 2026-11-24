import { callCommand } from './ipc'

export const linkService = {
  open: (url: string, itemId?: string) => callCommand('open_url', { url, itemId }),
}
