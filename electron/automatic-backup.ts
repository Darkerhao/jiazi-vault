import { randomUUID } from 'node:crypto'
import { mkdir, readdir, stat, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import type { AutomaticBackupStatus } from './contracts.js'
import { backupRevision, recordBackup } from './backup-status.js'
import { writePrivateFile } from './private-file.js'

export const AUTOMATIC_BACKUP_INTERVAL = 15 * 60_000
const FILE_NAME = /^auto-(\d{13})-[a-f0-9-]{36}\.jvault$/
interface SavedBackup { at: number; revision: number; file: string }

function readRecord(db: DatabaseSync): SavedBackup | null {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'automatic_backup_record'").get()
  return row ? JSON.parse(String(row.value)) : null
}

function directory(db: DatabaseSync): string | null {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'automatic_backup'").get()
  return row ? JSON.parse(String(row.value)).directory : null
}

export async function setAutomaticBackupDirectory(db: DatabaseSync, path: string | null, assertActive: () => void = () => {}) {
  if (path) await mkdir(path, { recursive: true })
  assertActive()
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('automatic_backup', ?)").run(JSON.stringify({ directory: path }))
  db.exec("DELETE FROM settings WHERE key IN ('automatic_backup_record', 'automatic_backup_error')")
}

export async function automaticBackupStatus(db: DatabaseSync): Promise<AutomaticBackupStatus> {
  const path = directory(db), saved = readRecord(db)
  let fileExists = false, unreadable = false
  if (path && saved) {
    try { fileExists = (await stat(join(path, saved.file))).isFile() }
    catch (error) { unreadable = (error as NodeJS.ErrnoException).code !== 'ENOENT' }
  }
  return { directory: path, lastBackupAt: saved?.at ?? null, fileExists,
    error: unreadable || Boolean(db.prepare("SELECT 1 FROM settings WHERE key = 'automatic_backup_error'").get()) }
}

/** Called under the main process operation lock; retains only files in the selected managed directory. */
export async function runAutomaticBackup(db: DatabaseSync, snapshot: () => string, assertActive: () => void, force = false, now = Date.now()) {
  const path = directory(db)
  if (!path) return false
  try {
    const status = await automaticBackupStatus(db), saved = readRecord(db)
    assertActive()
    const revision = backupRevision(db)
    if (!force && status.fileExists && saved
      && (saved.revision === revision || now - saved.at < AUTOMATIC_BACKUP_INTERVAL)) return false
    const contents = snapshot()
    const file = `auto-${now}-${randomUUID()}.jvault`
    await writePrivateFile(join(path, file), contents, assertActive)
    assertActive()
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('automatic_backup_record', ?)")
      .run(JSON.stringify({ at: now, revision, file } satisfies SavedBackup))
    recordBackup(db, revision, now)
    const files = (await readdir(path, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && FILE_NAME.test(entry.name))
      .map((entry) => entry.name).sort().reverse()
    for (const name of files.slice(10)) { assertActive(); await unlink(join(path, name)) }
    db.exec("DELETE FROM settings WHERE key = 'automatic_backup_error'")
    return true
  } catch (error) {
    if (!(error instanceof Error && error.message === 'VAULT_LOCKED')) {
      db.exec("INSERT OR REPLACE INTO settings (key, value) VALUES ('automatic_backup_error', '1')")
    }
    throw error
  }
}
