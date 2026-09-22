import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { decryptValue, encryptValue, type EncryptedValue } from './vault-crypto.js'

export type ItemType = 'login' | 'password' | 'server' | 'database' | 'api-key' | 'ssh' | 'secure-note' | 'custom'
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

export type VaultItemSummary = Omit<VaultItem, 'password' | 'fields' | 'notes'> & { hasSensitiveData?: boolean }

export type ItemInput = Omit<VaultItem, 'id' | 'createdAt' | 'updatedAt'>

interface ItemRow {
  id: string
  type: string
  title: string
  project_id: string | null
  environment: string | null
  username: string | null
  url: string | null
  host: string | null
  port: number | null
  tags: string
  secret: string
  has_secret: number
  favorite: number
  created_at: number
  updated_at: number
}

interface SecretPayload {
  password?: string
  notes?: string
  fields?: Record<string, string>
}

function parseTags(raw: string): string[] | undefined {
  try {
    const tags = JSON.parse(raw) as string[]
    return tags.length ? tags : undefined
  } catch {
    return undefined
  }
}

export interface ItemStore {
  create(input: ItemInput): VaultItemSummary
  get(id: string): VaultItem | null
  list(trashed?: boolean): VaultItemSummary[]
  update(item: VaultItem): VaultItemSummary
  toggleFavorite(id: string): VaultItemSummary | null
  remove(id: string, permanently?: boolean): void
  restore(id: string): void
}

export function createItemStore(db: DatabaseSync, getKey: () => Buffer): ItemStore {
  const insertStmt = db.prepare(`
    INSERT INTO items (id, type, title, project_id, environment, username, url, host, port, tags, secret, has_secret, favorite, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const updateStmt = db.prepare(`
    UPDATE items SET type = ?, title = ?, project_id = ?, environment = ?, username = ?, url = ?, host = ?, port = ?, tags = ?, secret = ?, has_secret = ?, updated_at = ?
    WHERE id = ?
  `)
  const selectById = db.prepare('SELECT * FROM items WHERE id = ?')
  const selectActive = db.prepare('SELECT * FROM items WHERE deleted_at IS NULL ORDER BY updated_at DESC')
  const selectTrashed = db.prepare('SELECT * FROM items WHERE deleted_at IS NOT NULL ORDER BY updated_at DESC')
  const toggleFavStmt = db.prepare('UPDATE items SET favorite = CASE favorite WHEN 1 THEN 0 ELSE 1 END, updated_at = ? WHERE id = ?')
  const softDeleteStmt = db.prepare('UPDATE items SET deleted_at = ? WHERE id = ?')
  const hardDeleteStmt = db.prepare('DELETE FROM items WHERE id = ?')
  const restoreStmt = db.prepare('UPDATE items SET deleted_at = NULL WHERE id = ?')

  function rowToBase(row: ItemRow) {
    return {
      id: row.id,
      type: row.type as ItemType,
      title: row.title,
      projectId: row.project_id ?? undefined,
      environment: (row.environment as Environment | null) ?? undefined,
      username: row.username ?? undefined,
      url: row.url ?? undefined,
      host: row.host ?? undefined,
      port: row.port ?? undefined,
      tags: parseTags(row.tags),
      favorite: row.favorite === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }

  function rowToSummary(row: ItemRow): VaultItemSummary {
    return { ...rowToBase(row), hasSensitiveData: row.has_secret === 1 }
  }

  function rowToItem(row: ItemRow): VaultItem {
    const secret = JSON.parse(row.secret) as EncryptedValue
    const payload = JSON.parse(decryptValue(getKey(), secret)) as SecretPayload
    return { ...rowToBase(row), password: payload.password, notes: payload.notes, fields: payload.fields }
  }

  function buildSecret(input: ItemInput) {
    const payload: SecretPayload = {}
    if (input.password) payload.password = input.password
    if (input.notes) payload.notes = input.notes
    if (input.fields && Object.keys(input.fields).length) payload.fields = input.fields
    const hasSecret = Boolean(payload.password || payload.notes || (payload.fields && Object.values(payload.fields).some(Boolean)))
    return { secret: JSON.stringify(encryptValue(getKey(), JSON.stringify(payload))), hasSecret }
  }

  function assertValid(input: ItemInput) {
    if (!input.title?.trim() || !input.type) throw new Error('INVALID_DATA')
    if (input.projectId && !db.prepare('SELECT 1 FROM projects WHERE id = ?').get(input.projectId)) throw new Error('PROJECT_NOT_FOUND')
    if (input.environment && !['development', 'testing', 'staging', 'production', 'other'].includes(input.environment)) throw new Error('INVALID_DATA')
  }

  return {
    create(input) {
      assertValid(input)
      const id = randomUUID()
      const now = Date.now()
      const { secret, hasSecret } = buildSecret(input)
      insertStmt.run(
        id, input.type, input.title, input.projectId ?? null, input.environment ?? null,
        input.username ?? null, input.url ?? null, input.host ?? null, input.port ?? null,
        JSON.stringify(input.tags ?? []), secret, hasSecret ? 1 : 0, input.favorite ? 1 : 0, now, now,
      )
      return rowToSummary(selectById.get(id) as unknown as ItemRow)
    },
    get(id) {
      const row = selectById.get(id) as unknown as ItemRow | undefined
      return row ? rowToItem(row) : null
    },
    list(trashed = false) {
      const rows = (trashed ? selectTrashed.all() : selectActive.all()) as unknown as ItemRow[]
      return rows.map(rowToSummary)
    },
    update(item) {
      assertValid(item)
      const now = Date.now()
      const { secret, hasSecret } = buildSecret(item)
      updateStmt.run(
        item.type, item.title, item.projectId ?? null, item.environment ?? null,
        item.username ?? null, item.url ?? null, item.host ?? null, item.port ?? null,
        JSON.stringify(item.tags ?? []), secret, hasSecret ? 1 : 0, now, item.id,
      )
      return rowToSummary(selectById.get(item.id) as unknown as ItemRow)
    },
    toggleFavorite(id) {
      toggleFavStmt.run(Date.now(), id)
      const row = selectById.get(id) as unknown as ItemRow | undefined
      return row ? rowToSummary(row) : null
    },
    remove(id, permanently = false) {
      if (permanently) hardDeleteStmt.run(id)
      else softDeleteStmt.run(Date.now(), id)
    },
    restore(id) {
      restoreStmt.run(id)
    },
  }
}
