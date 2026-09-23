export type ItemType = 'login' | 'password' | 'server' | 'database' | 'api-key' | 'ssh' | 'secure-note' | 'custom'
export type Environment = 'development' | 'testing' | 'staging' | 'production' | 'other'
export type TransferFormat = 'json' | 'csv'

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

export type VaultItemSummary = Omit<VaultItem, 'password' | 'fields' | 'notes'> & { hasSensitiveData?: boolean }
export type ItemInput = Omit<VaultItem, 'id' | 'createdAt' | 'updatedAt' | 'lastAccessedAt' | 'deletedAt'>
export interface BiometricStatus {
  label: 'Windows Hello' | 'Touch ID' | '生物识别'
  available: boolean
  enabled: boolean
}
