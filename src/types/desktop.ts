export interface BackupStatus { lastBackupAt: number | null; hasChanges: boolean }
export interface AppSettings {
  themeMode: 'system' | 'light' | 'dark'
  clipboardClearTimeout: 'never' | 5 | 10 | 15 | 30 | 60
  autoLockMinutes: 5 | 15 | 30 | 60 | null
}
export interface DesktopPreferences { silentStart: boolean; closeToTray: boolean }
export interface DesktopSettings extends DesktopPreferences { openAtLogin: boolean; startupSupported: boolean }
export type DesktopSetting = keyof DesktopPreferences | 'openAtLogin'
export type DesktopAction = 'open' | 'quick-search' | 'generator' | 'new-item' | 'new-project'
export interface ProjectInput { name: string; icon?: string; color?: string; description?: string }
export interface Project extends ProjectInput { id: string; itemCount: number; lastAccessedAt?: number }
export interface PasswordOptions { length: number; uppercase: boolean; lowercase: boolean; numbers: boolean; symbols: boolean; excludeAmbiguous: boolean }
export interface GeneratedPassword { password: string; entropy: number; strength: '弱' | '一般' | '强' | '非常强' }
export interface AppRelease { tag: string; version: string; notes: string; publishedAt: string | null }
export interface AppUpdate { version: string; newer: boolean; notes: string }
export interface UpdateState {
  automatic: boolean
  status: 'idle' | 'checking' | 'downloading' | 'confirming' | 'ready' | 'installing' | 'current' | 'available' | 'error'
  update: AppUpdate | null
  percent: number
  error: string
}
export const DEFAULT_SEARCH_SHORTCUT = 'CommandOrControl+Alt+K'
export function validateSearchShortcut(value: unknown): asserts value is string | null {
  if (value !== null && (typeof value !== 'string' || !/^CommandOrControl\+(?:Alt\+(?:Shift\+)?|Shift\+)[A-Z0-9]$/.test(value))) throw new Error('INVALID_SHORTCUT')
  if (['CommandOrControl+Shift+L', 'CommandOrControl+Shift+N', 'CommandOrControl+Shift+C'].includes(value ?? '')) throw new Error('RESERVED_SHORTCUT')
}
