import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export interface DatabaseState {
  connection: DatabaseSync
  path: string
}

export function openDatabase(userDataPath: string): DatabaseState {
  mkdirSync(userDataPath, { recursive: true })
  const path = join(userDataPath, 'vault.db')
  const connection = new DatabaseSync(path)

  connection.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS vault_metadata (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL
    );
  `)

  return { connection, path }
}
