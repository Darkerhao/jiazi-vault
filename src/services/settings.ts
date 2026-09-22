import type { AppSettings } from '../../electron/settings'
import { callCommand } from './ipc'

export const settingsService = {
  get: () => callCommand('get_settings'),
  save: (settings: AppSettings) => callCommand('update_settings', { settings }),
}
