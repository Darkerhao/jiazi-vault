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
    CREATE TABLE IF NOT EXISTS items (
      id TEXT PRIMARY KEY NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      project_id TEXT,
      environment TEXT,
      username TEXT,
      url TEXT,
      host TEXT,
      port INTEGER,
      tags TEXT NOT NULL DEFAULT '[]',
      secret TEXT NOT NULL,
      has_secret INTEGER NOT NULL DEFAULT 0,
      favorite INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      deleted_at INTEGER
    );
  `)

  return { connection, path }
}
