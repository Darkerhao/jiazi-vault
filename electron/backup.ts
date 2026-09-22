import type { DatabaseSync, SQLInputValue } from 'node:sqlite'
import { clearKey, decryptValue, encryptValue, isVaultMetadata, unlockVaultCredential, type EncryptedValue, type VaultMetadata } from './vault-crypto.js'
import { readSettings, validateSettings, writeSettings, type AppSettings } from './settings.js'

const ITEM_COLUMNS = ['id', 'type', 'title', 'project_id', 'environment', 'username', 'url', 'host', 'port', 'tags', 'secret', 'has_secret', 'favorite', 'created_at', 'updated_at', 'deleted_at'] as const
type ItemRow = Record<typeof ITEM_COLUMNS[number], SQLInputValue>

interface BackupEnvelope {
  format: 'jiazi-vault'
  version: 1
  metadata: VaultMetadata
  payload: EncryptedValue
}

export interface RestoredBackup {
  metadata: VaultMetadata
  items: ItemRow[]
  settings: AppSettings
}

export function createBackup(db: DatabaseSync, metadata: VaultMetadata, key: Buffer): string {
  const payload = {
    items: db.prepare('SELECT * FROM items ORDER BY id').all(),
    settings: readSettings(db),
  }
  const envelope: BackupEnvelope = {
    format: 'jiazi-vault', version: 1, metadata,
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
    if (envelope?.format !== 'jiazi-vault' || envelope.version !== 1 || !isVaultMetadata(envelope.metadata)) throw new Error('INVALID_BACKUP')
    key = await unlockVaultCredential(password, envelope.metadata)
    if (!key) throw new Error('BACKUP_PASSWORD_OR_DATA_INVALID')
    const payload = JSON.parse(decryptValue(key, envelope.payload)) as { items?: unknown; settings?: unknown }
    if (!payload || !Array.isArray(payload.items)) throw new Error('INVALID_BACKUP')
    const items = payload.items.map((item) => validateItem(item, key!))
    if (new Set(items.map((item) => item.id)).size !== items.length) throw new Error('INVALID_BACKUP')
    return { metadata: envelope.metadata, items, settings: validateSettings(payload.settings) }
  } catch {
    // No parser, SQLite or crypto errors (which can contain input data) cross IPC.
    throw new Error('BACKUP_PASSWORD_OR_DATA_INVALID')
  } finally { clearKey(key) }
}

export function restoreBackup(db: DatabaseSync, backup: RestoredBackup) {
  db.exec('BEGIN IMMEDIATE')
  try {
    db.exec('DELETE FROM items; DELETE FROM vault_metadata; DELETE FROM settings;')
    db.prepare('INSERT INTO vault_metadata (key, value) VALUES (?, ?)').run('vault', JSON.stringify(backup.metadata))
    const insert = db.prepare(`INSERT INTO items (${ITEM_COLUMNS.join(', ')}) VALUES (${ITEM_COLUMNS.map(() => '?').join(', ')})`)
    for (const row of backup.items) insert.run(...ITEM_COLUMNS.map((field) => row[field]))
    writeSettings(db, backup.settings)
    db.exec('COMMIT')
  } catch {
    db.exec('ROLLBACK')
    throw new Error('BACKUP_RESTORE_FAILED')
  }
}
