import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, rmdirSync } from 'node:fs'
import { basename, join } from 'node:path'
import { openDatabase } from './database.js'
import { restoreBackup, type RestoredBackup } from './backup.js'

const DATABASE_FILES = ['vault.db', 'vault.db-journal', 'vault.db-wal', 'vault.db-shm']

/** Prepare a complete replacement before moving any original database files. */
export function recoverDatabase(userDataPath: string, backup: RestoredBackup) {
  const staging = mkdtempSync(join(userDataPath, 'restore-'))
  const preserved = join(userDataPath, 'recovery', basename(staging))
  const moved: string[] = []
  try {
    const prepared = openDatabase(staging)
    try { restoreBackup(prepared.connection, backup) }
    finally { prepared.connection.close() }

    mkdirSync(preserved, { recursive: true })
    try {
      for (const name of DATABASE_FILES) {
        const path = join(userDataPath, name)
        if (!existsSync(path)) continue
        renameSync(path, join(preserved, name))
        moved.push(name)
      }
      renameSync(join(staging, 'vault.db'), join(userDataPath, 'vault.db'))
    } catch (error) {
      for (const name of moved.reverse()) renameSync(join(preserved, name), join(userDataPath, name))
      rmdirSync(preserved)
      throw error
    }
  } finally {
    for (const name of DATABASE_FILES) rmSync(join(staging, name), { force: true })
    rmdirSync(staging)
  }
}
