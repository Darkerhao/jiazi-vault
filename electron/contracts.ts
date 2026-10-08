export const ITEM_TYPES = ['login', 'password', 'server', 'database', 'api-key', 'ssh', 'secure-note', 'custom', 'env'] as const
export type ItemType = typeof ITEM_TYPES[number]
export type Environment = 'development' | 'testing' | 'staging' | 'production' | 'other'
export type TransferFormat = 'json' | 'csv'
export type ExportScope = { kind: 'all' } | { kind: 'project'; projectId: string } | { kind: 'items'; ids: string[] }
export type ItemBatchAction = { type: 'project'; projectId: string | null } | { type: 'environment'; environment: Environment | null } | { type: 'trash' } | { type: 'restore' }
export interface BackupSource { token: string; name: string }
export interface BackupPreview extends BackupSource { itemCount: number; trashedCount: number; projectCount: number; historyCount: number }

export interface VaultItem {
  id: string
  type: ItemType
  title: string
  projectId?: string
  environment?: Environment
  username?: string
  password?: string
  url?: string
  host?: string
  port?: number
  fields?: Record<string, string>
  notes?: string
  tags?: string[]
  favorite: boolean
  createdAt: number
  updatedAt: number
  lastAccessedAt?: number
  deletedAt?: number
}

export type VaultItemSummary = Omit<VaultItem, 'password' | 'fields' | 'notes'> & { hasSensitiveData?: boolean; expiresAt?: string }
export type ItemInput = Omit<VaultItem, 'id' | 'createdAt' | 'updatedAt' | 'lastAccessedAt' | 'deletedAt'>
export interface ItemHistorySummary { id: number; savedAt: number }
export interface AutomaticBackupStatus {
  directory: string | null
  lastBackupAt: number | null
  fileExists: boolean
  error: boolean
}
export interface RecoverySnapshot { id: string; createdAt: number }
export interface BiometricStatus {
  label: 'Windows Hello' | 'Touch ID' | '生物识别'
  available: boolean
  enabled: boolean
}

export interface ImportPreviewRow { row: number; title: string; type: string; duplicate: boolean; error?: string }
export interface ImportPreview { token: string; name: string; rows: ImportPreviewRow[]; validCount: number; duplicateCount: number; invalidCount: number }
