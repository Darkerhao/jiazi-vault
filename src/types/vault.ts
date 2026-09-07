export type ItemType =
  | 'login'
  | 'password'
  | 'server'
  | 'database'
  | 'api-key'
  | 'ssh'
  | 'secure-note'
  | 'custom'

export type Environment = 'development' | 'testing' | 'staging' | 'production' | 'other'

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
}

export interface VaultItemSummary extends Omit<VaultItem, 'password' | 'fields' | 'notes'> {
  hasSensitiveData?: boolean
}

export interface Project {
  id: string
  name: string
  icon?: string
  color?: string
  description?: string
  itemCount: number
  lastAccessedAt?: number
}
