import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { openDatabase } from '../dist-electron/database.js'
import { createItemStore } from '../dist-electron/item-store.js'
import { createVaultCredential, clearKey, encryptValue } from '../dist-electron/vault-crypto.js'
import { createBackup, readBackup, restoreBackup } from '../dist-electron/backup.js'
import { replaceVaultPassword } from '../dist-electron/vault-password.js'
import { createProjectStore } from '../dist-electron/project-store.js'

async function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'keystill-history-'))
  const { connection: db } = openDatabase(directory)
  const credential = await createVaultCredential('history-fixture-password')
  db.prepare('INSERT INTO vault_metadata VALUES (?, ?)').run('vault', JSON.stringify(credential.metadata))
  let key = credential.masterKey
  t.after(() => {
    db.close(); clearKey(key); clearKey(credential.masterKey)
    assert.equal(dirname(directory), tmpdir()); assert.ok(basename(directory).startsWith('keystill-history-'))
    rmSync(directory, { recursive: true, force: true })
  })
  return { db, credential, setKey: (value) => { key = value }, store: createItemStore(db, () => key) }
}

test('history encrypts complete prior content, restores it atomically, and preserves usage/favorite', async (t) => {
  const { db, store } = await fixture(t)
  const item = store.create({ type: 'env', title: 'Old private title', environment: 'testing', fields: { TOKEN: 'old-secret', EMPTY: '' }, favorite: false })
  const original = store.get(item.id)
  store.update({ ...original, title: 'Current', fields: { TOKEN: 'new-secret' } })
  const [version] = store.listHistory(item.id)
  assert.equal(store.getHistory(item.id, version.id).fields.EMPTY, '')
  const raw = db.prepare('SELECT * FROM item_history').get()
  assert.ok(!JSON.stringify(raw).includes('old-secret'))
  assert.ok(!JSON.stringify(raw).includes('Old private title'))
  assert.equal(JSON.stringify(version).includes('TOKEN'), false)
  store.toggleFavorite(item.id)
  const usedAt = store.markUsed(item.id)
  store.restoreHistory(item.id, version.id)
  assert.deepEqual(store.get(item.id).fields, original.fields)
  assert.equal(store.get(item.id).favorite, true)
  assert.equal(store.get(item.id).lastAccessedAt, usedAt)
  assert.equal(store.listHistory(item.id).length, 2)
  const other = store.create({ type: 'password', title: 'Other', favorite: false })
  assert.throws(() => store.getHistory(other.id, version.id), /HISTORY_NOT_FOUND/)
})

test('history is bounded, edits rollback together, and permanent deletion removes history', async (t) => {
  const { db, store } = await fixture(t)
  const item = store.create({ type: 'password', title: 'Version 0', password: 'initial', favorite: false })
  for (let i = 1; i <= 25; i++) store.update({ ...store.get(item.id), title: `Version ${i}` })
  assert.equal(store.listHistory(item.id).length, 20)
  const before = db.prepare('SELECT * FROM item_history ORDER BY id').all()
  db.exec("CREATE TRIGGER reject_edit BEFORE UPDATE ON items BEGIN SELECT RAISE(ABORT, 'fixture'); END")
  assert.throws(() => store.update({ ...store.get(item.id), password: 'rejected' }))
  assert.deepEqual(db.prepare('SELECT * FROM item_history ORDER BY id').all(), before)
  db.exec('DROP TRIGGER reject_edit')
  store.remove(item.id)
  assert.equal(store.listHistory(item.id).length, 20)
  assert.throws(() => store.restoreHistory(item.id, before[0].id), /ITEM_IN_TRASH/)
  store.remove(item.id, true)
  assert.equal(db.prepare('SELECT COUNT(*) AS total FROM item_history').get().total, 0)
})

test('history survives backup v4 and master password changes', async (t) => {
  const { db, store, credential, setKey } = await fixture(t)
  const item = store.create({ type: 'password', title: 'Example', password: 'old-secret', favorite: false })
  store.update({ ...store.get(item.id), password: 'new-secret' })
  const contents = createBackup(db, credential.metadata, credential.masterKey)
  assert.equal(JSON.parse(contents).version, 4)
  const backup = await readBackup(contents, 'history-fixture-password')
  restoreBackup(db, backup)
  const [version] = store.listHistory(item.id)
  assert.equal(store.getHistory(item.id, version.id).password, 'old-secret')
  const next = await createVaultCredential('next-fixture-password')
  replaceVaultPassword(db, credential.masterKey, next)
  setKey(next.masterKey)
  assert.equal(store.getHistory(item.id, version.id).password, 'old-secret')
  assert.equal((await readBackup(createBackup(db, next.metadata, next.masterKey), 'next-fixture-password')).history.length, 1)
})

test('a corrupt history rolls back password rotation and is rejected during backup validation', async (t) => {
  const { db, store, credential } = await fixture(t)
  const item = store.create({ type: 'password', title: 'Example', password: 'before', favorite: false })
  store.update({ ...store.get(item.id), password: 'after' })
  db.exec("UPDATE item_history SET payload = '{}' ")
  const next = await createVaultCredential('next-fixture-password')
  t.after(() => clearKey(next.masterKey))
  const current = db.prepare('SELECT secret FROM items').get().secret
  assert.throws(() => replaceVaultPassword(db, credential.masterKey, next), /PASSWORD_CHANGE_FAILED/)
  assert.equal(db.prepare('SELECT secret FROM items').get().secret, current)
  assert.equal(store.get(item.id).password, 'after')
  await assert.rejects(readBackup(createBackup(db, credential.metadata, credential.masterKey), 'history-fixture-password'), /BACKUP_PASSWORD_OR_DATA_INVALID/)
})

test('restoring history from a deleted project keeps its content without recreating the project', async (t) => {
  const { db, store } = await fixture(t), projects = createProjectStore(db)
  const project = projects.create({ name: 'Old project' })
  const item = store.create({ type: 'password', title: 'Example', password: 'before', projectId: project.id, favorite: false })
  store.update({ ...store.get(item.id), password: 'after' })
  const [version] = store.listHistory(item.id)
  projects.remove(project.id)
  store.restoreHistory(item.id, version.id)
  assert.equal(store.get(item.id).password, 'before')
  assert.equal(store.get(item.id).projectId, undefined)
  assert.deepEqual(projects.list(), [])
})

test('correcting a legacy expiry date does not make the preserved history invalidate future backups', async (t) => {
  const { db, store, credential } = await fixture(t)
  const item = store.create({ type: 'api-key', title: 'Legacy', fields: { apiKey: 'old-token' }, favorite: false })
  db.prepare('UPDATE items SET secret = ? WHERE id = ?').run(JSON.stringify(encryptValue(credential.masterKey, JSON.stringify({ fields: { apiKey: 'old-token', expiresAt: 'legacy-invalid-date' } }))), item.id)
  store.update({ ...store.get(item.id), fields: { apiKey: 'old-token', expiresAt: '2026-12-31' } })
  const backup = await readBackup(createBackup(db, credential.metadata, credential.masterKey), 'history-fixture-password')
  restoreBackup(db, backup)
  assert.equal(store.getHistory(item.id, store.listHistory(item.id)[0].id).fields.expiresAt, 'legacy-invalid-date')
  assert.equal(store.get(item.id).fields.expiresAt, '2026-12-31')
})
