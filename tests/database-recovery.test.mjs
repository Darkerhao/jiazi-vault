import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { openDatabase } from '../dist-electron/database.js'
import { createVaultCredential, clearKey } from '../dist-electron/vault-crypto.js'
import { createItemStore } from '../dist-electron/item-store.js'
import { createBackup, readBackup } from '../dist-electron/backup.js'
import { recoverDatabase } from '../dist-electron/database-recovery.js'

async function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'jiazi-recovery-test-'))
  t.after(() => {
    assert.equal(dirname(directory), tmpdir())
    assert.ok(basename(directory).startsWith('jiazi-recovery-test-'))
    rmSync(directory, { recursive: true, force: true })
  })
  const db = openDatabase(directory)
  const credential = await createVaultCredential('recovery-fixture-password')
  t.after(() => clearKey(credential.masterKey))
  try {
    const item = createItemStore(db.connection, () => credential.masterKey).create({ type: 'password', title: 'Restore me', password: 'fixture-secret', favorite: false })
    const backup = await readBackup(createBackup(db.connection, credential.metadata, credential.masterKey), 'recovery-fixture-password')
    return { directory, backup, item, key: credential.masterKey }
  } finally { db.connection.close() }
}

test('recovery preserves the unreadable database and all SQLite sidecars before installing a complete replacement', async (t) => {
  const { directory, backup, item, key } = await fixture(t)
  const files = ['vault.db', 'vault.db-journal', 'vault.db-wal', 'vault.db-shm']
  for (const file of files) writeFileSync(join(directory, file), `original ${file}`)
  recoverDatabase(directory, backup)
  const [saved] = readdirSync(join(directory, 'recovery'))
  for (const file of files) assert.equal(readFileSync(join(directory, 'recovery', saved, file), 'utf8'), `original ${file}`)
  const restored = openDatabase(directory)
  try { assert.equal(createItemStore(restored.connection, () => key).get(item.id).password, 'fixture-secret') }
  finally { restored.connection.close() }
  assert.equal(readdirSync(directory).some((name) => name.startsWith('restore-')), false)
})

test('a failed replacement build leaves original files untouched and cleans its staging directory', async (t) => {
  const { directory, backup } = await fixture(t)
  const original = Buffer.from('unreadable original fixture')
  writeFileSync(join(directory, 'vault.db'), original)
  backup.items.push(backup.items[0])
  assert.throws(() => recoverDatabase(directory, backup), /BACKUP_RESTORE_FAILED/)
  assert.deepEqual(readFileSync(join(directory, 'vault.db')), original)
  assert.deepEqual(readdirSync(directory), ['vault.db'])
})

test('failure to create the preservation directory leaves the original vault untouched', async (t) => {
  const { directory, backup } = await fixture(t)
  const original = readFileSync(join(directory, 'vault.db'))
  writeFileSync(join(directory, 'recovery'), 'fixture blocks directory creation')
  assert.throws(() => recoverDatabase(directory, backup))
  assert.deepEqual(readFileSync(join(directory, 'vault.db')), original)
  assert.equal(readdirSync(directory).some((name) => name.startsWith('restore-')), false)
})
