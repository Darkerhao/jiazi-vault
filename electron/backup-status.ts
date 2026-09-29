import type { DatabaseSync } from 'node:sqlite'

export interface BackupStatus {
  lastBackupAt: number | null
  hasChanges: boolean
}

/** Changes are tracked in the same transaction as data, including imports and deletions. */
export function initializeBackupTracking(db: DatabaseSync) {
  db.exec("INSERT OR IGNORE INTO settings (key, value) VALUES ('backup_revision', '1')")
  const tables = {
    items: 'type, title, project_id, environment, username, url, host, port, tags, secret, favorite, deleted_at',
    projects: 'name, icon, color, description',
    vault_metadata: 'value',
    settings: 'value',
  }
  for (const [table, columns] of Object.entries(tables)) {
    for (const operation of ['INSERT', 'UPDATE', 'DELETE']) {
      const row = operation === 'DELETE' ? 'OLD' : 'NEW'
      const condition = table === 'settings' ? `WHEN ${row}.key = 'preferences'` : table === 'vault_metadata' ? `WHEN ${row}.key = 'vault'` : ''
      db.exec(`CREATE TRIGGER IF NOT EXISTS backup_${table}_${operation}
        AFTER ${operation === 'UPDATE' ? `UPDATE OF ${columns}` : operation} ON ${table} ${condition}
        BEGIN
          INSERT INTO settings (key, value) VALUES ('backup_revision', '1')
          ON CONFLICT(key) DO UPDATE SET value = CAST(value AS INTEGER) + 1;
        END`)
    }
  }
}

export function backupRevision(db: DatabaseSync): number {
  return Number(db.prepare("SELECT value FROM settings WHERE key = 'backup_revision'").get()?.value ?? 0)
}

export function readBackupStatus(db: DatabaseSync): BackupStatus {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'backup_record'").get()
  const saved = row ? JSON.parse(String(row.value)) as { at: number; revision: number } : null
  return { lastBackupAt: saved?.at ?? null, hasChanges: !saved || saved.revision !== backupRevision(db) }
}

export function recordBackup(db: DatabaseSync, revision: number, at = Date.now()) {
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('backup_record', ?)").run(JSON.stringify({ at, revision }))
}
