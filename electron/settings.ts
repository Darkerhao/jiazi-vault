import type { DatabaseSync } from 'node:sqlite'

export const DEFAULT_SEARCH_SHORTCUT = 'CommandOrControl+Alt+K'
export function validateSearchShortcut(value: unknown): asserts value is string | null {
  if (value !== null && (typeof value !== 'string' || !/^CommandOrControl\+(?:Alt\+(?:Shift\+)?|Shift\+)[A-Z0-9]$/.test(value))) throw new Error('INVALID_SHORTCUT')
  if (['CommandOrControl+Shift+L', 'CommandOrControl+Shift+N', 'CommandOrControl+Shift+C'].includes(value ?? '')) throw new Error('RESERVED_SHORTCUT')
}

export function readSearchShortcut(db: DatabaseSync): string | null {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('search-shortcut')
  const value: unknown = row ? JSON.parse(String(row.value)) : DEFAULT_SEARCH_SHORTCUT
  validateSearchShortcut(value)
  return value
}

export function writeSearchShortcut(db: DatabaseSync, value: unknown): string | null {
  validateSearchShortcut(value)
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('search-shortcut', JSON.stringify(value))
  return value
}

export interface AppSettings {
  themeMode: 'system' | 'light' | 'dark'
  clipboardClearTimeout: 'never' | 5 | 10 | 15 | 30 | 60
  autoLockMinutes: 5 | 15 | 30 | 60 | null
}

export const DEFAULT_SETTINGS: Readonly<AppSettings> = { themeMode: 'system', clipboardClearTimeout: 15, autoLockMinutes: 15 }

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
  return row ? validateSettings(JSON.parse(String(row.value))) : { ...DEFAULT_SETTINGS }
}

export function writeSettings(db: DatabaseSync, value: unknown): AppSettings {
  const settings = validateSettings(value)
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('preferences', JSON.stringify(settings))
  return settings
}
