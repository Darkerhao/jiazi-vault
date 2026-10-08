import { validExpiry } from './expiry.js'
import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { decryptValue, encryptValue, type EncryptedValue } from './vault-crypto.js'

import type { ItemType, Environment, ItemInput, VaultItem, VaultItemSummary, ItemHistorySummary, ItemBatchAction } from './contracts.js'
import { ITEM_TYPES } from './contracts.js'
import { validateEnvFields } from './env.js'
export type { ItemType, Environment, ItemInput, VaultItem, VaultItemSummary } from './contracts.js'

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
  last_accessed_at: number | null
  deleted_at: number | null
}

interface SecretPayload {
  password?: string
  notes?: string
  fields?: Record<string, string>
}

export function validateItemInput(value: unknown, checkExpiry = true): asserts value is ItemInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_DATA')
  const input = value as ItemInput
  if (typeof input.title !== 'string' || !input.title.trim()
    || !ITEM_TYPES.includes(input.type)
    || (input.favorite !== undefined && typeof input.favorite !== 'boolean')
    || ['projectId', 'username', 'password', 'url', 'host', 'notes'].some((field) => {
      const entry = input[field as keyof ItemInput]
      return entry !== undefined && typeof entry !== 'string'
    })
    || (input.environment !== undefined && !['development', 'testing', 'staging', 'production', 'other'].includes(input.environment))
    || (input.port !== undefined && (!Number.isInteger(input.port) || input.port < 0 || input.port > 65535))
    || (input.tags !== undefined && (!Array.isArray(input.tags) || input.tags.some((tag) => typeof tag !== 'string')))
    || (input.fields !== undefined && (!input.fields || typeof input.fields !== 'object' || Array.isArray(input.fields)
      || Object.values(input.fields).some((field) => typeof field !== 'string')))) throw new Error('INVALID_DATA')
  if (checkExpiry && input.type === 'api-key' && input.fields?.expiresAt && !validExpiry(input.fields.expiresAt)) throw new Error('INVALID_EXPIRY')
  if (input.type === 'env') {
    if (!input.environment) throw new Error('INVALID_DATA')
    validateEnvFields(input.fields)
  }
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
  batch(ids: string[], action: ItemBatchAction): number
  listHistory(id: string): ItemHistorySummary[]
  getHistory(id: string, historyId: number): VaultItem
  restoreHistory(id: string, historyId: number): VaultItemSummary
  create(input: ItemInput): VaultItemSummary
  get(id: string, recordAccess?: boolean): VaultItem | null
  markUsed(id: string): number | null
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
  const softDeleteStmt = db.prepare('UPDATE items SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL')
  const markUsedStmt = db.prepare('UPDATE items SET last_accessed_at = ? WHERE id = ? AND deleted_at IS NULL')
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
      lastAccessedAt: row.last_accessed_at ?? undefined,
      deletedAt: row.deleted_at ?? undefined,
    }
  }

  function rowToSummary(row: ItemRow): VaultItemSummary {
    const expiresAt = row.type === 'api-key' ? rowToItem(row).fields?.expiresAt : undefined
    return { ...rowToBase(row), hasSensitiveData: row.has_secret === 1, ...(expiresAt ? { expiresAt } : {}) }
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
    validateItemInput(input)
    if (input.projectId && !db.prepare('SELECT 1 FROM projects WHERE id = ?').get(input.projectId)) throw new Error('PROJECT_NOT_FOUND')
  }

  function markUsed(id: string): number | null {
    const now = Date.now()
    return markUsedStmt.run(now, id).changes ? now : null
  }

  function getHistory(id: string, historyId: number): VaultItem {
    const row = db.prepare('SELECT payload FROM item_history WHERE item_id = ? AND id = ?').get(id, historyId)
    if (!row) throw new Error('HISTORY_NOT_FOUND')
    return JSON.parse(decryptValue(getKey(), JSON.parse(String(row.payload)))) as VaultItem
  }

  function update(item: VaultItem): VaultItemSummary {
    assertValid(item)
    const row = selectById.get(item.id) as unknown as ItemRow | undefined
    if (!row) throw new Error('ITEM_NOT_FOUND')
    if (row.deleted_at !== null) throw new Error('ITEM_IN_TRASH')
    const previous = rowToItem(row)
    const now = Date.now()
    const { secret, hasSecret } = buildSecret(item)
    const history = JSON.stringify(encryptValue(getKey(), JSON.stringify(previous)))
    db.exec('SAVEPOINT item_update')
    try {
      db.prepare('INSERT INTO item_history (item_id, saved_at, payload) VALUES (?, ?, ?)').run(item.id, now, history)
      updateStmt.run(
        item.type, item.title, item.projectId ?? null, item.environment ?? null,
        item.username ?? null, item.url ?? null, item.host ?? null, item.port ?? null,
        JSON.stringify(item.tags ?? []), secret, hasSecret ? 1 : 0, now, item.id,
      )
      db.prepare('DELETE FROM item_history WHERE item_id = ? AND id NOT IN (SELECT id FROM item_history WHERE item_id = ? ORDER BY id DESC LIMIT 20)').run(item.id, item.id)
      db.exec('RELEASE item_update')
    } catch (error) { db.exec('ROLLBACK TO item_update; RELEASE item_update'); throw error }
    return rowToSummary(selectById.get(item.id) as unknown as ItemRow)
  }

  return {
    batch(ids, action) {
      getKey()
      if (!Array.isArray(ids) || !ids.length || ids.some((id) => typeof id !== 'string' || !id)
        || !action || !['project', 'environment', 'trash', 'restore'].includes(action.type)) throw new Error('INVALID_DATA')
      if (action.type === 'project' && action.projectId !== null && (typeof action.projectId !== 'string' || !action.projectId)) throw new Error('INVALID_DATA')
      if (action.type === 'environment' && action.environment !== null && !['development', 'testing', 'staging', 'production', 'other'].includes(action.environment)) throw new Error('INVALID_DATA')
      let changed = 0
      db.exec('SAVEPOINT item_batch')
      try {
        for (const id of new Set(ids)) {
          const row = selectById.get(id) as unknown as ItemRow | undefined
          if (!row) throw new Error('ITEM_NOT_FOUND')
          if ((action.type === 'restore') !== (row.deleted_at !== null)) throw new Error('ITEM_STATE_CHANGED')
          if (action.type === 'trash') softDeleteStmt.run(Date.now(), id)
          else if (action.type === 'restore') restoreStmt.run(id)
          else {
            const item = rowToItem(row)
            if (action.type === 'project') {
              if (item.projectId === (action.projectId ?? undefined)) continue
              item.projectId = action.projectId ?? undefined
            } else {
              if (item.type === 'env' && action.environment === null) throw new Error('ENVIRONMENT_REQUIRED')
              if (item.environment === (action.environment ?? undefined)) continue
              item.environment = action.environment ?? undefined
            }
            update(item)
          }
          changed++
        }
        db.exec('RELEASE item_batch')
        return changed
      } catch (error) { db.exec('ROLLBACK TO item_batch; RELEASE item_batch'); throw error }
    },
    listHistory(id) {
      getKey()
      return db.prepare('SELECT id, saved_at FROM item_history WHERE item_id = ? ORDER BY id DESC').all(id)
        .map((row) => ({ id: Number(row.id), savedAt: Number(row.saved_at) }))
    },
    getHistory,
    restoreHistory(id, historyId) {
      const previous = getHistory(id, historyId)
      if (previous.projectId && !db.prepare('SELECT 1 FROM projects WHERE id = ?').get(previous.projectId)) delete previous.projectId
      return update({ ...previous, id })
    },
    update,
    markUsed,
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
    get(id, recordAccess = false) {
      const row = selectById.get(id) as unknown as ItemRow | undefined
      if (!row) return null
      const item = rowToItem(row)
      if (recordAccess) item.lastAccessedAt = markUsed(id) ?? item.lastAccessedAt
      return item
    },
    list(trashed = false) {
      const rows = (trashed ? selectTrashed.all() : selectActive.all()) as unknown as ItemRow[]
      return rows.map(rowToSummary)
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
