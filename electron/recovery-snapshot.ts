import { randomUUID } from 'node:crypto'
import { chmodSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { RecoverySnapshot } from './contracts.js'
import { assertBackupSize, createBackup, readBackup } from './backup.js'
import { clearKey, unlockVaultCredential, type VaultMetadata } from './vault-crypto.js'

const SNAPSHOT_NAME = /^snapshot-(\d{13})-[a-f0-9-]{36}\.db$/

export function createRecoverySnapshot(db: DatabaseSync, userDataPath: string): string {
  const directory = join(userDataPath, 'recovery')
  const id = `snapshot-${Date.now()}-${randomUUID()}.db`
  const path = join(directory, id)
  try {
    mkdirSync(directory, { recursive: true })
    db.prepare('VACUUM INTO ?').run(path)
    chmodSync(path, 0o600)
    return id
  } catch {
    try { rmSync(path, { force: true }) } catch { /* Keep the snapshot error independent of cleanup. */ }
    throw new Error('RECOVERY_SNAPSHOT_FAILED')
  }
}

export function listRecoverySnapshots(userDataPath: string): RecoverySnapshot[] {
  try {
    return readdirSync(join(userDataPath, 'recovery'), { withFileTypes: true })
      .filter((entry) => entry.isFile() && SNAPSHOT_NAME.test(entry.name))
      .map((entry) => ({ id: entry.name, createdAt: Number(SNAPSHOT_NAME.exec(entry.name)![1]) }))
      .sort((a, b) => b.createdAt - a.createdAt)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw new Error('RECOVERY_SNAPSHOT_FAILED')
  }
}

export async function readRecoverySnapshot(userDataPath: string, id: string, password: string) {
  if (typeof id !== 'string' || !listRecoverySnapshots(userDataPath).some((snapshot) => snapshot.id === id)) throw new Error('INVALID_SNAPSHOT')
  const path = join(userDataPath, 'recovery', id)
  assertBackupSize(statSync(path).size)
  const db = new DatabaseSync(path, { readOnly: true })
  let key: Buffer | null = null
  try {
    const metadata = JSON.parse(String(db.prepare("SELECT value FROM vault_metadata WHERE key = 'vault'").get()?.value)) as VaultMetadata
    key = await unlockVaultCredential(password, metadata)
    if (!key) throw new Error('INVALID_PASSWORD')
    // Reuse the portable backup validator, including history, before touching the live database.
    return await readBackup(createBackup(db, metadata, key), password)
  } finally { clearKey(key); db.close() }
}
