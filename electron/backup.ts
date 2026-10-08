import type { DatabaseSync, SQLInputValue } from 'node:sqlite'
import { clearKey, decryptValue, encryptValue, isVaultMetadata, unlockVaultCredential, type EncryptedValue, type VaultMetadata } from './vault-crypto.js'
import { readSettings, validateSettings, writeSettings, type AppSettings } from './settings.js'
import { validateProject } from './project-store.js'
import { purgeExpiredItems } from './database.js'
import { ITEM_TYPES, type ItemType } from './contracts.js'
import { validateEnvFields } from './env.js'
import { validateItemInput } from './item-store.js'

export const BACKUP_MAX_BYTES = 256 * 1024 * 1024

export function assertBackupSize(bytes: number) {
  if (bytes > BACKUP_MAX_BYTES) throw new Error('BACKUP_TOO_LARGE')
}

const ITEM_COLUMNS = ['id', 'type', 'title', 'project_id', 'environment', 'username', 'url', 'host', 'port', 'tags', 'secret', 'has_secret', 'favorite', 'created_at', 'updated_at', 'deleted_at', 'last_accessed_at'] as const
type ItemRow = Record<typeof ITEM_COLUMNS[number], SQLInputValue>
const PROJECT_COLUMNS = ['id', 'name', 'icon', 'color', 'description', 'last_accessed_at'] as const
type ProjectRow = Record<typeof PROJECT_COLUMNS[number], SQLInputValue>
interface HistoryRow { id: number; item_id: string; saved_at: number; payload: string }

interface BackupEnvelope {
  format: 'jiazi-vault'
  version: 1 | 2 | 3 | 4
  metadata: VaultMetadata
  payload: EncryptedValue
}

export interface RestoredBackup {
  metadata: VaultMetadata
  items: ItemRow[]
  projects: ProjectRow[]
  settings: AppSettings
  history: HistoryRow[]
}

export function createBackup(db: DatabaseSync, metadata: VaultMetadata, key: Buffer): string {
  const payload = {
    items: db.prepare('SELECT * FROM items ORDER BY id').all(),
    projects: db.prepare('SELECT * FROM projects ORDER BY id').all(),
    settings: readSettings(db),
    history: db.prepare('SELECT * FROM item_history ORDER BY id').all(),
  }
  const envelope: BackupEnvelope = {
    format: 'jiazi-vault', version: 4, metadata,
    payload: encryptValue(key, JSON.stringify(payload)),
  }
  const contents = JSON.stringify(envelope)
  assertBackupSize(Buffer.byteLength(contents, 'utf8'))
  return contents
}

function validateItem(value: unknown, key: Buffer, version: number): ItemRow {
  if (!value || typeof value !== 'object') throw new Error('INVALID_BACKUP')
  const row = value as ItemRow
  if (version < 3 && row.last_accessed_at === undefined) row.last_accessed_at = null
  const strings = ['id', 'type', 'title', 'tags', 'secret'] as const
  const nullableStrings = ['project_id', 'environment', 'username', 'url', 'host'] as const
  if (strings.some((field) => typeof row[field] !== 'string')
    || !row.id || !row.title
    || nullableStrings.some((field) => row[field] !== null && typeof row[field] !== 'string')
    || !ITEM_TYPES.includes(row.type as ItemType)
    || (row.environment !== null && !['development', 'testing', 'staging', 'production', 'other'].includes(String(row.environment)))
    || ![0, 1].includes(Number(row.favorite)) || ![0, 1].includes(Number(row.has_secret))
    || ['favorite', 'has_secret', 'created_at', 'updated_at'].some((field) => !Number.isSafeInteger(row[field as keyof ItemRow]))
    || (row.port !== null && (!Number.isSafeInteger(row.port) || Number(row.port) < 0 || Number(row.port) > 65535))
    || (row.deleted_at !== null && !Number.isSafeInteger(row.deleted_at))
    || (row.last_accessed_at !== null && (!Number.isSafeInteger(row.last_accessed_at) || Number(row.last_accessed_at) < 0))) throw new Error('INVALID_BACKUP')

  const tags: unknown = JSON.parse(String(row.tags))
  if (!Array.isArray(tags) || tags.some((tag) => typeof tag !== 'string')) throw new Error('INVALID_BACKUP')
  const secret: unknown = JSON.parse(decryptValue(key, JSON.parse(String(row.secret))))
  if (!secret || typeof secret !== 'object' || Array.isArray(secret)) throw new Error('INVALID_BACKUP')
  const fields = secret as { password?: unknown; notes?: unknown; fields?: unknown }
  if ((fields.password !== undefined && typeof fields.password !== 'string')
    || (fields.notes !== undefined && typeof fields.notes !== 'string')
    || (fields.fields !== undefined && (!fields.fields || typeof fields.fields !== 'object' || Array.isArray(fields.fields)
      || Object.values(fields.fields).some((entry) => typeof entry !== 'string')))) throw new Error('INVALID_BACKUP')
  if (row.type === 'env') {
    if (!row.environment) throw new Error('INVALID_BACKUP')
    validateEnvFields(fields.fields)
  }
  return row
}

/** Authenticate and validate everything before opening a transaction on the live vault. */
export async function readBackup(contents: string, password: string): Promise<RestoredBackup> {
  assertBackupSize(Buffer.byteLength(contents, 'utf8'))
  let key: Buffer | null = null
  try {
    const envelope = JSON.parse(contents) as BackupEnvelope
    if (envelope?.format !== 'jiazi-vault' || ![1, 2, 3, 4].includes(envelope.version) || !isVaultMetadata(envelope.metadata)) throw new Error('INVALID_BACKUP')
    key = await unlockVaultCredential(password, envelope.metadata)
    if (!key) throw new Error('BACKUP_PASSWORD_OR_DATA_INVALID')
    const payload = JSON.parse(decryptValue(key, envelope.payload)) as { items?: unknown; projects?: unknown; settings?: unknown; history?: unknown }
    if (!payload || !Array.isArray(payload.items)) throw new Error('INVALID_BACKUP')
    if (envelope.version === 1 && payload.projects !== undefined) throw new Error('INVALID_BACKUP')
    const items = payload.items.map((item) => validateItem(item, key!, envelope.version))
    if (new Set(items.map((item) => item.id)).size !== items.length) throw new Error('INVALID_BACKUP')
    // Version 1 predates projects and has no project table to restore.
    const projects = envelope.version === 1 ? [] : validateProjects(payload.projects)
    const projectIds = new Set(projects.map((p) => p.id))
    for (const item of items) {
      if (envelope.version === 1) item.project_id = null
      else if (item.project_id !== null && !projectIds.has(item.project_id)) throw new Error('INVALID_BACKUP')
    }
    const history = envelope.version < 4 ? [] : validateHistory(payload.history, items, key)
    return { metadata: envelope.metadata, items, projects, settings: validateSettings(payload.settings), history }
  } catch {
    // No parser, SQLite or crypto errors (which can contain input data) cross IPC.
    throw new Error('BACKUP_PASSWORD_OR_DATA_INVALID')
  } finally { clearKey(key) }
}

function validateHistory(value: unknown, items: ItemRow[], key: Buffer): HistoryRow[] {
  if (!Array.isArray(value)) throw new Error('INVALID_BACKUP')
  const itemIds = new Set(items.map((item) => item.id))
  const ids = new Set<number>(), counts = new Map<string, number>()
  return value.map((row: HistoryRow) => {
    if (!row || !Number.isSafeInteger(row.id) || row.id < 1 || ids.has(row.id)
      || typeof row.item_id !== 'string' || !itemIds.has(row.item_id)
      || !Number.isSafeInteger(row.saved_at) || row.saved_at < 0 || typeof row.payload !== 'string') throw new Error('INVALID_BACKUP')
    const item = JSON.parse(decryptValue(key, JSON.parse(row.payload)))
    if (item.id !== row.item_id) throw new Error('INVALID_BACKUP')
    // Preserve legacy dates in history, just as validateItem preserves them in current records.
    validateItemInput(item, false)
    ids.add(row.id)
    const count = (counts.get(row.item_id) ?? 0) + 1
    if (count > 20) throw new Error('INVALID_BACKUP')
    counts.set(row.item_id, count)
    return row
  })
}

function validateProjects(value: unknown): ProjectRow[] {
  if (!Array.isArray(value)) throw new Error('INVALID_BACKUP')
  const ids = new Set<string>()
  const names = new Set<string>()
  return value.map((row: ProjectRow) => {
    if (!row || typeof row.id !== 'string' || !row.id || ids.has(row.id)
      || (row.last_accessed_at !== null && !Number.isSafeInteger(row.last_accessed_at))) throw new Error('INVALID_BACKUP')
    const p = validateProject({ name: row.name, icon: row.icon ?? undefined, color: row.color ?? undefined, description: row.description ?? undefined })
    const name = p.name.replace(/[A-Z]/g, (letter) => letter.toLowerCase())
    if (names.has(name)) throw new Error('INVALID_BACKUP')
    ids.add(row.id)
    names.add(name)
    return { id: row.id, name: p.name, icon: p.icon ?? null, color: p.color ?? null, description: p.description ?? null, last_accessed_at: row.last_accessed_at }
  })
}

export function restoreBackup(db: DatabaseSync, backup: RestoredBackup) {
  db.exec('BEGIN IMMEDIATE')
  try {
    db.exec("DELETE FROM items; DELETE FROM projects; DELETE FROM vault_metadata; DELETE FROM settings WHERE key NOT IN ('automatic_backup', 'search-shortcut');")
    db.prepare('INSERT INTO vault_metadata (key, value) VALUES (?, ?)').run('vault', JSON.stringify(backup.metadata))
    const insertProject = db.prepare(`INSERT INTO projects (${PROJECT_COLUMNS.join(', ')}) VALUES (${PROJECT_COLUMNS.map(() => '?').join(', ')})`)
    for (const row of backup.projects) insertProject.run(...PROJECT_COLUMNS.map((field) => row[field]))
    const insert = db.prepare(`INSERT INTO items (${ITEM_COLUMNS.join(', ')}) VALUES (${ITEM_COLUMNS.map(() => '?').join(', ')})`)
    for (const row of backup.items) insert.run(...ITEM_COLUMNS.map((field) => row[field]))
    const insertHistory = db.prepare('INSERT INTO item_history (id, item_id, saved_at, payload) VALUES (?, ?, ?, ?)')
    for (const row of backup.history) insertHistory.run(row.id, row.item_id, row.saved_at, row.payload)
    writeSettings(db, backup.settings)
    purgeExpiredItems(db)
    db.exec('COMMIT')
  } catch {
    db.exec('ROLLBACK')
    throw new Error('BACKUP_RESTORE_FAILED')
  }
}
