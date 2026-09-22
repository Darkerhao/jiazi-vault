import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, rmSync, rmdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase, purgeExpiredItems, TRASH_RETENTION_MS } from '../dist-electron/database.js'
import { createItemStore } from '../dist-electron/item-store.js'
import { createVaultCredential, encryptValue, decryptValue, clearKey } from '../dist-electron/vault-crypto.js'
import { createBackup, readBackup, restoreBackup } from '../dist-electron/backup.js'

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'jiazi-lifecycle-'))
  let state = openDatabase(dir)
  const key = Buffer.alloc(32, 5)
  t.after(() => { clearKey(key); state.connection.close(); rmSync(state.path); rmdirSync(dir) })
  return {
    get db() { return state.connection }, key,
    get store() { return createItemStore(state.connection, () => key) },
    restart() { state.connection.close(); state = openDatabase(dir) },
  }
}

test('view and successful use persist independently from edits, listing, favorite and pure reads', (t) => {
  const f = fixture(t)
  const item = f.store.create({ type: 'password', title: 'sample', password: 'secret', favorite: false })
  assert.equal(item.lastAccessedAt, undefined)
  assert.equal(f.store.get(item.id).lastAccessedAt, undefined)
  assert.equal(f.store.toggleFavorite(item.id).lastAccessedAt, undefined)
  const viewed = f.store.get(item.id, true)
  assert.ok(viewed.lastAccessedAt > 0)
  f.store.update({ ...viewed, title: 'edited', lastAccessedAt: 1 })
  assert.equal(f.store.get(item.id).lastAccessedAt, viewed.lastAccessedAt)
  const usedAt = f.store.markUsed(item.id)
  f.restart()
  assert.equal(f.store.list()[0].lastAccessedAt, usedAt)
  assert.equal(f.store.get(item.id).password, 'secret')
  f.store.remove(item.id)
  assert.equal(f.store.markUsed(item.id), null)
  assert.equal(f.store.markUsed('missing'), null)
})

test('30 day boundary deletes only expired trash, repeated delete preserves deadline, restart cleans', (t) => {
  const f = fixture(t)
  const now = Date.now()
  const make = (title) => f.store.create({ type: 'password', title, favorite: false })
  const expired = make('expired'), pending = make('pending'), active = make('active'), restored = make('restored')
  const set = f.db.prepare('UPDATE items SET deleted_at = ? WHERE id = ?')
  set.run(now - TRASH_RETENTION_MS, expired.id)
  set.run(now - TRASH_RETENTION_MS + 1, pending.id)
  set.run(now - TRASH_RETENTION_MS - 1, restored.id)
  f.store.restore(restored.id)
  f.store.remove(expired.id)
  assert.equal(f.store.list(true).find((item) => item.id === expired.id).deletedAt, now - TRASH_RETENTION_MS)
  assert.equal(purgeExpiredItems(f.db, now), 1)
  assert.equal(f.store.get(expired.id), null)
  assert.ok(f.store.get(pending.id))
  assert.ok(f.store.get(active.id))
  assert.ok(f.store.get(restored.id))
  set.run(now - TRASH_RETENTION_MS - 1, pending.id)
  f.restart()
  assert.equal(f.store.get(pending.id), null)
})

test('existing database migrates idempotently without inventing historical usage', (t) => {
  const f = fixture(t)
  const item = f.store.create({ type: 'login', title: 'old row', favorite: false })
  f.db.exec('ALTER TABLE items DROP COLUMN last_accessed_at')
  f.restart()
  assert.equal(f.store.get(item.id).lastAccessedAt, undefined)
  f.restart()
  assert.equal(f.store.list().length, 1)
})

test('backup v3 preserves usage, v1/v2 accept missing usage, restore cannot resurrect expired trash', async (t) => {
  const f = fixture(t)
  const credential = await createVaultCredential('lifecycle-backup-password')
  t.after(() => clearKey(credential.masterKey))
  const store = createItemStore(f.db, () => credential.masterKey)
  const active = store.create({ type: 'password', title: 'used', password: 'secret', favorite: false })
  const usedAt = store.markUsed(active.id)
  const trash = store.create({ type: 'password', title: 'expired', favorite: false })
  f.db.prepare('UPDATE items SET deleted_at = ? WHERE id = ?').run(Date.now() - TRASH_RETENTION_MS - 1, trash.id)
  const contents = createBackup(f.db, credential.metadata, credential.masterKey)
  const envelope = JSON.parse(contents)
  assert.equal(envelope.version, 3)
  const backup = await readBackup(contents, 'lifecycle-backup-password')
  restoreBackup(f.db, backup)
  assert.equal(store.get(active.id).lastAccessedAt, usedAt)
  assert.equal(store.get(trash.id), null)
  for (const version of [1, 2]) {
    const payload = JSON.parse(decryptValue(credential.masterKey, envelope.payload))
    for (const row of payload.items) delete row.last_accessed_at
    if (version === 1) delete payload.projects
    const old = await readBackup(JSON.stringify({ ...envelope, version, payload: encryptValue(credential.masterKey, JSON.stringify(payload)) }), 'lifecycle-backup-password')
    restoreBackup(f.db, old)
    assert.equal(store.get(active.id).lastAccessedAt, undefined)
  }
})
