import type { AppSettings } from '../types/desktop'
import { callCommand } from './ipc'

export const settingsService = {
  get: () => callCommand('get_settings'),
  save: (settings: AppSettings) => callCommand('update_settings', { settings }),
}
