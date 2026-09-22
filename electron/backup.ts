import type { DatabaseSync, SQLInputValue } from 'node:sqlite'
import { clearKey, decryptValue, encryptValue, isVaultMetadata, unlockVaultCredential, type EncryptedValue, type VaultMetadata } from './vault-crypto.js'
import { readSettings, validateSettings, writeSettings, type AppSettings } from './settings.js'
import { validateProject } from './project-store.js'

const ITEM_COLUMNS = ['id', 'type', 'title', 'project_id', 'environment', 'username', 'url', 'host', 'port', 'tags', 'secret', 'has_secret', 'favorite', 'created_at', 'updated_at', 'deleted_at'] as const
type ItemRow = Record<typeof ITEM_COLUMNS[number], SQLInputValue>
const PROJECT_COLUMNS = ['id', 'name', 'icon', 'color', 'description', 'last_accessed_at'] as const
type ProjectRow = Record<typeof PROJECT_COLUMNS[number], SQLInputValue>

interface BackupEnvelope {
  format: 'jiazi-vault'
  version: 1 | 2
  metadata: VaultMetadata
  payload: EncryptedValue
}

export interface RestoredBackup {
  metadata: VaultMetadata
  items: ItemRow[]
  projects: ProjectRow[]
  settings: AppSettings
}

export function createBackup(db: DatabaseSync, metadata: VaultMetadata, key: Buffer): string {
  const payload = {
    items: db.prepare('SELECT * FROM items ORDER BY id').all(),
    projects: db.prepare('SELECT * FROM projects ORDER BY id').all(),
    settings: readSettings(db),
  }
  const envelope: BackupEnvelope = {
    format: 'jiazi-vault', version: 2, metadata,
    payload: encryptValue(key, JSON.stringify(payload)),
  }
  return JSON.stringify(envelope)
}

function validateItem(value: unknown, key: Buffer): ItemRow {
  if (!value || typeof value !== 'object') throw new Error('INVALID_BACKUP')
  const row = value as ItemRow
  const strings = ['id', 'type', 'title', 'tags', 'secret'] as const
  const nullableStrings = ['project_id', 'environment', 'username', 'url', 'host'] as const
  if (strings.some((field) => typeof row[field] !== 'string')
    || !row.id || !row.title
    || nullableStrings.some((field) => row[field] !== null && typeof row[field] !== 'string')
    || !['login', 'password', 'server', 'database', 'api-key', 'ssh', 'secure-note', 'custom'].includes(String(row.type))
    || (row.environment !== null && !['development', 'testing', 'staging', 'production', 'other'].includes(String(row.environment)))
    || ![0, 1].includes(Number(row.favorite)) || ![0, 1].includes(Number(row.has_secret))
    || ['favorite', 'has_secret', 'created_at', 'updated_at'].some((field) => !Number.isSafeInteger(row[field as keyof ItemRow]))
    || (row.port !== null && (!Number.isSafeInteger(row.port) || Number(row.port) < 0 || Number(row.port) > 65535))
    || (row.deleted_at !== null && !Number.isSafeInteger(row.deleted_at))) throw new Error('INVALID_BACKUP')

  const tags: unknown = JSON.parse(String(row.tags))
  if (!Array.isArray(tags) || tags.some((tag) => typeof tag !== 'string')) throw new Error('INVALID_BACKUP')
  const secret: unknown = JSON.parse(decryptValue(key, JSON.parse(String(row.secret))))
  if (!secret || typeof secret !== 'object' || Array.isArray(secret)) throw new Error('INVALID_BACKUP')
  const fields = secret as { password?: unknown; notes?: unknown; fields?: unknown }
  if ((fields.password !== undefined && typeof fields.password !== 'string')
    || (fields.notes !== undefined && typeof fields.notes !== 'string')
    || (fields.fields !== undefined && (!fields.fields || typeof fields.fields !== 'object' || Array.isArray(fields.fields)
      || Object.values(fields.fields).some((entry) => typeof entry !== 'string')))) throw new Error('INVALID_BACKUP')
  return row
}

/** Authenticate and validate everything before opening a transaction on the live vault. */
export async function readBackup(contents: string, password: string): Promise<RestoredBackup> {
  let key: Buffer | null = null
  try {
    const envelope = JSON.parse(contents) as BackupEnvelope
    if (envelope?.format !== 'jiazi-vault' || ![1, 2].includes(envelope.version) || !isVaultMetadata(envelope.metadata)) throw new Error('INVALID_BACKUP')
    key = await unlockVaultCredential(password, envelope.metadata)
    if (!key) throw new Error('BACKUP_PASSWORD_OR_DATA_INVALID')
    const payload = JSON.parse(decryptValue(key, envelope.payload)) as { items?: unknown; projects?: unknown; settings?: unknown }
    if (!payload || !Array.isArray(payload.items)) throw new Error('INVALID_BACKUP')
    if (envelope.version === 1 && payload.projects !== undefined) throw new Error('INVALID_BACKUP')
    const items = payload.items.map((item) => validateItem(item, key!))
    if (new Set(items.map((item) => item.id)).size !== items.length) throw new Error('INVALID_BACKUP')
    // Version 1 predates projects and has no project table to restore.
    const projects = envelope.version === 1 ? [] : validateProjects(payload.projects)
    const projectIds = new Set(projects.map((p) => p.id))
    for (const item of items) {
      if (envelope.version === 1) item.project_id = null
      else if (item.project_id !== null && !projectIds.has(item.project_id)) throw new Error('INVALID_BACKUP')
    }
    return { metadata: envelope.metadata, items, projects, settings: validateSettings(payload.settings) }
  } catch {
    // No parser, SQLite or crypto errors (which can contain input data) cross IPC.
    throw new Error('BACKUP_PASSWORD_OR_DATA_INVALID')
  } finally { clearKey(key) }
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
    db.exec('DELETE FROM items; DELETE FROM projects; DELETE FROM vault_metadata; DELETE FROM settings;')
    db.prepare('INSERT INTO vault_metadata (key, value) VALUES (?, ?)').run('vault', JSON.stringify(backup.metadata))
    const insertProject = db.prepare(`INSERT INTO projects (${PROJECT_COLUMNS.join(', ')}) VALUES (${PROJECT_COLUMNS.map(() => '?').join(', ')})`)
    for (const row of backup.projects) insertProject.run(...PROJECT_COLUMNS.map((field) => row[field]))
    const insert = db.prepare(`INSERT INTO items (${ITEM_COLUMNS.join(', ')}) VALUES (${ITEM_COLUMNS.map(() => '?').join(', ')})`)
    for (const row of backup.items) insert.run(...ITEM_COLUMNS.map((field) => row[field]))
    writeSettings(db, backup.settings)
    db.exec('COMMIT')
  } catch {
    db.exec('ROLLBACK')
    throw new Error('BACKUP_RESTORE_FAILED')
  }
}
