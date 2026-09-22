import type { DatabaseSync } from 'node:sqlite'

export interface AppSettings {
  themeMode: 'system' | 'light' | 'dark'
  clipboardClearTimeout: 'never' | 5 | 10 | 15 | 30 | 60
  autoLockMinutes: 5 | 15 | 30 | 60 | null
}

const defaults: AppSettings = { themeMode: 'system', clipboardClearTimeout: 15, autoLockMinutes: 15 }

export function validateSettings(value: unknown): AppSettings {
  if (!value || typeof value !== 'object') throw new Error('INVALID_SETTINGS')
  const settings = value as AppSettings
  if (!['system', 'light', 'dark'].includes(settings.themeMode)
    || !['never', 5, 10, 15, 30, 60].includes(settings.clipboardClearTimeout)
    || ![null, 5, 15, 30, 60].includes(settings.autoLockMinutes)) throw new Error('INVALID_SETTINGS')
  return {
    themeMode: settings.themeMode,
    clipboardClearTimeout: settings.clipboardClearTimeout,
    autoLockMinutes: settings.autoLockMinutes,
  }
}

export function readSettings(db: DatabaseSync): AppSettings {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('preferences')
  return row ? validateSettings(JSON.parse(String(row.value))) : { ...defaults }
}

export function writeSettings(db: DatabaseSync, value: unknown): AppSettings {
  const settings = validateSettings(value)
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('preferences', JSON.stringify(settings))
  return settings
}
