import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase } from '../dist-electron/database.js'
import { createVaultCredential, unlockVaultCredential, clearKey, encryptValue, decryptValue } from '../dist-electron/vault-crypto.js'
import { replaceVaultPassword } from '../dist-electron/vault-password.js'
import { BiometricVault } from '../dist-electron/biometric-vault.js'
import { VaultSession } from '../dist-electron/vault-session.js'
import { createItemStore } from '../dist-electron/item-store.js'
import { createBackup, readBackup } from '../dist-electron/backup.js'

async function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'jiazi-access-'))
  const { connection: db } = openDatabase(directory)
  const old = await createVaultCredential('old-master-password')
  db.prepare('INSERT INTO vault_metadata VALUES (?, ?)').run('vault', JSON.stringify(old.metadata))
  const store = createItemStore(db, () => old.masterKey)
  const active = store.create({ type: 'custom', title: 'active', password: 'secret', notes: 'notes', fields: { token: 'first\nsecond', empty: '' }, favorite: true })
  const trash = store.create({ type: 'ssh', title: 'trash', fields: { privateKey: 'private-key' } })
  store.markUsed(active.id)
  store.remove(trash.id)
  t.after(() => { clearKey(old.masterKey); db.close(); rmSync(directory, { recursive: true, force: true }) })
  return { db, old, active, trash, store }
}

test('password replacement preserves every field, access timestamp and trash; old password fails and old backups remain readable', async (t) => {
  const { db, old, active, trash, store } = await fixture(t)
  const before = [store.get(active.id), store.get(trash.id)]
  const backup = createBackup(db, old.metadata, old.masterKey)
  db.prepare('INSERT INTO vault_metadata VALUES (?, ?)').run('biometric', 'old-enrollment')
  db.exec('INSERT INTO unlock_attempts VALUES (1, 4, 0)')
  const next = await createVaultCredential('new-master-password')
  t.after(() => clearKey(next.masterKey))
  replaceVaultPassword(db, old.masterKey, next)
  assert.equal(await unlockVaultCredential('old-master-password', next.metadata), null)
  const unlocked = await unlockVaultCredential('new-master-password', next.metadata)
  t.after(() => clearKey(unlocked))
  const updated = createItemStore(db, () => unlocked)
  assert.deepEqual([updated.get(active.id), updated.get(trash.id)], before)
  assert.equal(db.prepare('SELECT 1 FROM vault_metadata WHERE key = ?').get('biometric'), undefined)
  assert.equal(db.prepare('SELECT 1 FROM unlock_attempts').get(), undefined)
  assert.equal((await readBackup(backup, 'old-master-password')).items.length, 2)
  await assert.rejects(readBackup(backup, 'new-master-password'), /BACKUP_PASSWORD_OR_DATA_INVALID/)
  assert.equal((await readBackup(createBackup(db, next.metadata, unlocked), 'new-master-password')).items.length, 2)
})

test('a corrupt credential rolls back all ciphertext, metadata, enrollment and limiter changes', async (t) => {
  const { db, old, trash } = await fixture(t)
  db.prepare('UPDATE items SET secret = ? WHERE id = ?').run('corrupt', trash.id)
  db.prepare('INSERT INTO vault_metadata VALUES (?, ?)').run('biometric', 'enrollment')
  const before = db.prepare('SELECT * FROM items').all()
  const metadata = db.prepare('SELECT * FROM vault_metadata').all()
  const next = await createVaultCredential('new-master-password')
  t.after(() => clearKey(next.masterKey))
  assert.throws(() => replaceVaultPassword(db, old.masterKey, next), /PASSWORD_CHANGE_FAILED/)
  assert.deepEqual(db.prepare('SELECT * FROM items').all(), before)
  assert.deepEqual(db.prepare('SELECT * FROM vault_metadata').all(), metadata)
})

test('a final metadata write error also rolls back previously reencrypted items', async (t) => {
  const { db, old } = await fixture(t)
  const before = db.prepare('SELECT * FROM items').all()
  db.exec("CREATE TRIGGER reject_password BEFORE UPDATE ON vault_metadata BEGIN SELECT RAISE(ABORT, 'fixture'); END")
  const next = await createVaultCredential('new-master-password')
  t.after(() => clearKey(next.masterKey))
  assert.throws(() => replaceVaultPassword(db, old.masterKey, next), /PASSWORD_CHANGE_FAILED/)
  assert.deepEqual(db.prepare('SELECT * FROM items').all(), before)
  assert.equal(db.prepare('SELECT value FROM vault_metadata WHERE key = ?').get('vault').value, JSON.stringify(old.metadata))
})

test('biometric unlock requires authentication each time; cancellation does not decrypt or enroll', async (t) => {
  const { db, old } = await fixture(t)
  const osKey = Buffer.alloc(32, 19)
  let verifies = 0, decrypts = 0, canceled = false
  const provider = {
    label: 'Windows Hello', available: async () => true,
    verify: async () => { verifies++; if (canceled) throw new Error('canceled') },
    protect: async (key) => Buffer.from(JSON.stringify(encryptValue(osKey, key.toString('base64')))),
    unprotect: async (encrypted) => { decrypts++; return Buffer.from(decryptValue(osKey, JSON.parse(encrypted)), 'base64') },
  }
  const biometric = new BiometricVault(db, provider)
  canceled = true
  await assert.rejects(biometric.prepare(old.masterKey), /canceled/)
  assert.equal((await biometric.status()).enabled, false)
  canceled = false
  biometric.save(await biometric.prepare(old.masterKey))
  const persisted = db.prepare('SELECT value FROM vault_metadata WHERE key = ?').get('biometric').value
  assert.equal(Buffer.from(persisted, 'base64').includes(old.masterKey.toString('base64')), false)
  for (let i = 0; i < 2; i++) {
    const key = await biometric.unlock(old.metadata)
    assert.deepEqual(key, old.masterKey)
    clearKey(key)
  }
  assert.equal(verifies, 4)
  assert.equal(decrypts, 2)
  canceled = true
  await assert.rejects(biometric.unlock(old.metadata), /canceled/)
  assert.equal(decrypts, 2)
  biometric.disable()
  assert.equal((await biometric.status()).enabled, false)
  await assert.rejects(biometric.unlock(old.metadata), /BIOMETRIC_UNAVAILABLE/)
})

test('device enrollment from another vault cannot unlock the current vault and the returned key is wiped', async (t) => {
  const { db, old } = await fixture(t)
  const wrongKey = Buffer.alloc(32, 3)
  const biometric = new BiometricVault(db, {
    label: 'Touch ID', available: async () => true, verify: async () => {},
    protect: async () => Buffer.from('fixture'), unprotect: async () => wrongKey,
  })
  biometric.save('fixture')
  await assert.rejects(biometric.unlock(old.metadata), /BIOMETRIC_INVALID/)
  assert.deepEqual(wrongKey, Buffer.alloc(32))
})

test('lock while biometric dialog is pending discards its key and never restores the session', async (t) => {
  const { db, old } = await fixture(t)
  let consent
  const key = Buffer.from(old.masterKey)
  const session = new VaultSession(() => 15, () => {})
  t.after(() => session.dispose())
  const biometric = new BiometricVault(db, {
    label: 'Windows Hello', available: async () => true,
    verify: () => new Promise((resolve) => { consent = resolve }),
    protect: async () => Buffer.from('fixture'), unprotect: async () => key,
  })
  biometric.save('fixture')
  const pending = session.authenticate(() => biometric.unlock(old.metadata))
  while (!consent) await Promise.resolve()
  session.lock()
  consent()
  await assert.rejects(pending, /VAULT_LOCKED/)
  assert.equal(session.unlocked, false)
  assert.deepEqual(key, Buffer.alloc(32))
})

test('password replacement interrupted during derivation cannot commit; the original vault stays intact', async (t) => {
  const { db, old } = await fixture(t)
  const before = db.prepare('SELECT * FROM items').all()
  const next = await createVaultCredential('new-master-password')
  const session = new VaultSession(() => 15, () => {})
  t.after(() => session.dispose())
  await session.authenticate(async () => Buffer.from(old.masterKey))
  let finish
  const pending = session.authenticate(() => new Promise((resolve) => { finish = resolve }), () => replaceVaultPassword(db, old.masterKey, next))
  session.lock()
  finish(next.masterKey)
  await assert.rejects(pending, /VAULT_LOCKED/)
  assert.deepEqual(db.prepare('SELECT * FROM items').all(), before)
  assert.deepEqual(next.masterKey, Buffer.alloc(32))
})
