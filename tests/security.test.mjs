import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, readFileSync, rmSync, rmdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase } from '../dist-electron/database.js'
import { createVaultCredential, unlockVaultCredential, clearKey, encryptValue, decryptValue } from '../dist-electron/vault-crypto.js'
import { createItemStore } from '../dist-electron/item-store.js'
import { readSettings, writeSettings } from '../dist-electron/settings.js'
import { createBackup, readBackup, restoreBackup } from '../dist-electron/backup.js'
import { VaultSession } from '../dist-electron/vault-session.js'
import { ClipboardManager } from '../dist-electron/clipboard-manager.js'
import { createProjectStore } from '../dist-electron/project-store.js'

const password = 'fixture-master-password'
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }

function database(t) {
  const dir = mkdtempSync(join(tmpdir(), 'jiazi-vault-test-'))
  const state = openDatabase(dir)
  t.after(() => {
    state.connection.close()
    rmSync(state.path)
    rmdirSync(dir)
  })
  return state
}

function clipboard(t, initialTimeout = 15) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 })
  let text = ''
  let timeout = initialTimeout
  const manager = new ClipboardManager({
    async readText() { return text },
    async writeText(value) { text = value },
    clear() { text = '' },
  }, () => timeout)
  return { manager, get text() { return text }, set text(value) { text = value }, set timeout(value) { timeout = value } }
}

test('settings survive a connection restart and reject invalid values without changing the saved settings', (t) => {
  const state = database(t)
  const expected = { themeMode: 'dark', clipboardClearTimeout: 5, autoLockMinutes: null }
  assert.deepEqual(readSettings(state.connection), { themeMode: 'system', clipboardClearTimeout: 15, autoLockMinutes: 15 })
  writeSettings(state.connection, expected)
  state.connection.close()
  state.connection = openDatabase(join(state.path, '..')).connection
  assert.deepEqual(readSettings(state.connection), expected)
  for (const patch of [{ themeMode: 'invalid' }, { clipboardClearTimeout: 0 }, { autoLockMinutes: -1 }, { autoLockMinutes: '5' }]) {
    assert.throws(() => writeSettings(state.connection, { ...expected, ...patch }), /INVALID_SETTINGS/)
  }
  assert.deepEqual(readSettings(state.connection), expected)
})

test('inactivity locks, wipes the key and cannot be undone by a late input event', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: 0 })
  let locks = 0
  const session = new VaultSession(() => 5, () => locks++)
  t.after(() => session.dispose())
  const key = Buffer.alloc(32, 7)
  await session.authenticate(async () => key)
  t.mock.timers.tick(299_000)
  session.touch()
  t.mock.timers.tick(299_000)
  assert.equal(session.unlocked, true)
  t.mock.timers.tick(1000)
  session.touch()
  assert.equal(session.unlocked, false)
  assert.equal(locks, 1)
  assert.deepEqual(key, Buffer.alloc(32))
  assert.throws(() => session.requireKey(), /VAULT_LOCKED/)
})

test('never disables the idle timer, while explicit lock still wipes the key', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: 0 })
  let timeout = null
  const session = new VaultSession(() => timeout, () => {})
  t.after(() => session.dispose())
  await session.authenticate(async () => Buffer.alloc(32, 1))
  t.mock.timers.tick(3_600_000)
  assert.equal(session.unlocked, true)
  timeout = 5
  session.checkExpiry()
  assert.equal(session.unlocked, false)
  await session.authenticate(async () => Buffer.alloc(32, 2))
  session.lock()
  assert.equal(session.unlocked, false)
})

test('locking during key derivation invalidates the result and prevents a create commit', async (t) => {
  const session = new VaultSession(() => 15, () => {})
  t.after(() => session.dispose())
  let resolve
  let commits = 0
  const key = Buffer.alloc(32, 8)
  const pending = session.authenticate(() => new Promise((done) => { resolve = done }), () => commits++)
  await assert.rejects(session.authenticate(async () => key), /VAULT_BUSY/)
  session.lock()
  resolve(key)
  await assert.rejects(pending, /VAULT_LOCKED/)
  assert.equal(commits, 0)
  assert.deepEqual(key, Buffer.alloc(32))
})

test('clipboard clears at the deadline and a later copy gets its own full timeout', async (t) => {
  const c = clipboard(t)
  await c.manager.copy('first', () => {})
  t.mock.timers.tick(14_000)
  assert.equal(c.text, 'first')
  await c.manager.copy('second', () => {})
  t.mock.timers.tick(1000)
  await flush()
  assert.equal(c.text, 'second')
  t.mock.timers.tick(14_000)
  await flush()
  assert.equal(c.text, '')
})

test('clipboard preserves another application content and lock clears even when timeout is never', async (t) => {
  const c = clipboard(t)
  await c.manager.copy('secret', () => {})
  c.text = 'copied in another app'
  t.mock.timers.tick(15_000)
  await flush()
  assert.equal(c.text, 'copied in another app')
  c.timeout = 'never'
  await c.manager.copy('secret', () => {})
  t.mock.timers.tick(60_000)
  await flush()
  assert.equal(c.text, 'secret')
  await c.manager.clearOnLock()
  assert.equal(c.text, '')
})

test('clipboard timeout changes apply to an outstanding copy', async (t) => {
  const c = clipboard(t)
  await c.manager.copy('secret', () => {})
  t.mock.timers.tick(6000)
  c.timeout = 5
  c.manager.reschedule()
  t.mock.timers.tick(1)
  await flush()
  assert.equal(c.text, '')
})

test('a queued expired timer cannot clear a newer copy', async (t) => {
  const c = clipboard(t)
  await c.manager.copy('same-secret', () => {})
  const nextCopy = c.manager.copy('same-secret', () => {})
  t.mock.timers.tick(15_000)
  await nextCopy
  await flush()
  assert.equal(c.text, 'same-secret')
  t.mock.timers.tick(15_000)
  await flush()
  assert.equal(c.text, '')
})

test('lock waits for an in-flight clipboard write and queued copies cannot run after lock', async () => {
  let text = ''
  let finishWrite
  let unlocked = true
  const c = new ClipboardManager({
    async readText() { return text },
    async writeText(value) { await new Promise((done) => { finishWrite = done }); text = value },
    clear() { text = '' },
  }, () => 'never')
  const assertUnlocked = () => { if (!unlocked) throw new Error('VAULT_LOCKED') }
  const first = c.copy('secret', assertUnlocked)
  await flush()
  const second = c.copy('second', assertUnlocked)
  unlocked = false
  const cleared = c.clearOnLock()
  finishWrite()
  await first
  await assert.rejects(second, /VAULT_LOCKED/)
  await cleared
  assert.equal(text, '')
})

test('encrypted backup restores secrets, metadata, favorites, trash and settings across passwords and restart', async (t) => {
  const source = database(t)
  const destination = database(t)
  const credential = await createVaultCredential(password)
  t.after(() => clearKey(credential.masterKey))
  source.connection.prepare('INSERT INTO vault_metadata VALUES (?, ?)').run('vault', JSON.stringify(credential.metadata))
  const sourceItems = createItemStore(source.connection, () => credential.masterKey)
  const projects = createProjectStore(source.connection)
  const project = projects.create({ name: 'private-project', icon: '📁', color: '#8ab4f8', description: 'project-description' })
  projects.visit(project.id)
  const item = sourceItems.create({ type: 'login', title: 'private-test-title', projectId: project.id, environment: 'production', username: 'test-user', password: 'private-test-secret', notes: 'private-test-note', fields: { token: 'private-test-token' }, tags: ['tag'], favorite: true })
  const trash = sourceItems.create({ type: 'ssh', title: 'trash-item', fields: { privateKey: 'private-ssh-key' }, favorite: false })
  sourceItems.remove(trash.id)
  const settings = { themeMode: 'light', clipboardClearTimeout: 10, autoLockMinutes: 30 }
  writeSettings(source.connection, settings)
  const contents = createBackup(source.connection, credential.metadata, credential.masterKey)
  assert.notEqual(contents, createBackup(source.connection, credential.metadata, credential.masterKey))
  for (const secret of ['private-project', 'project-description', 'private-test-title', 'test-user', 'private-test-secret', 'private-test-note', 'private-test-token', 'private-ssh-key', password]) {
    assert.equal(contents.includes(secret), false)
  }
  assert.equal(readFileSync(source.path).includes(Buffer.from('private-test-secret')), false)
  const old = await createVaultCredential('different-old-password')
  createItemStore(destination.connection, () => old.masterKey).create({ type: 'password', title: 'old-item', password: 'old-secret', favorite: false })
  clearKey(old.masterKey)
  restoreBackup(destination.connection, await readBackup(contents, password))
  destination.connection.close()
  destination.connection = openDatabase(join(destination.path, '..')).connection
  const metadata = JSON.parse(destination.connection.prepare('SELECT value FROM vault_metadata WHERE key = ?').get('vault').value)
  assert.equal(await unlockVaultCredential('different-old-password', metadata), null)
  const key = await unlockVaultCredential(password, metadata)
  t.after(() => clearKey(key))
  const restored = createItemStore(destination.connection, () => key)
  assert.deepEqual(restored.get(item.id), sourceItems.get(item.id))
  assert.deepEqual(restored.list(), sourceItems.list())
  assert.deepEqual(restored.list(true), sourceItems.list(true))
  assert.deepEqual(readSettings(destination.connection), settings)
  assert.deepEqual(createProjectStore(destination.connection).list(), projects.list())
})

test('wrong password, tampering, unsupported versions and invalid payloads leave the current database intact', async (t) => {
  const db = database(t)
  const credential = await createVaultCredential(password)
  t.after(() => clearKey(credential.masterKey))
  db.connection.prepare('INSERT INTO vault_metadata VALUES (?, ?)').run('vault', JSON.stringify(credential.metadata))
  createItemStore(db.connection, () => credential.masterKey).create({ type: 'password', title: 'keep me', password: 'secret', favorite: false })
  const backup = createBackup(db.connection, credential.metadata, credential.masterKey)
  const before = readFileSync(db.path)
  const restore = async (data, pass = password) => restoreBackup(db.connection, await readBackup(data, pass))
  await assert.rejects(restore(backup, 'wrong-password'), /BACKUP_PASSWORD_OR_DATA_INVALID/)
  for (const mutate of [
    (v) => { v.version = 99 },
    (v) => { v.version = 1 },
    (v) => { v.metadata.kdf.memoryCost = 2 ** 32 },
    (v) => { v.payload.ciphertext = 'AAAA' },
    (v) => { v.payload.authTag = 'AA==' },
    (v) => { const p = JSON.parse(decryptValue(credential.masterKey, v.payload)); p.items.push(p.items[0]); v.payload = encryptValue(credential.masterKey, JSON.stringify(p)) },
    (v) => { const p = JSON.parse(decryptValue(credential.masterKey, v.payload)); p.items[0].secret = '{}'; v.payload = encryptValue(credential.masterKey, JSON.stringify(p)) },
  ]) {
    const value = JSON.parse(backup)
    mutate(value)
    await assert.rejects(restore(JSON.stringify(value)), /BACKUP_PASSWORD_OR_DATA_INVALID/)
  }
  await assert.rejects(restore('{broken'), /BACKUP_PASSWORD_OR_DATA_INVALID/)
  assert.deepEqual(readFileSync(db.path), before)
})

test('SQLite failure during replacement rolls back the entire vault and settings', async (t) => {
  const db = database(t)
  const credential = await createVaultCredential(password)
  t.after(() => clearKey(credential.masterKey))
  db.connection.prepare('INSERT INTO vault_metadata VALUES (?, ?)').run('vault', JSON.stringify(credential.metadata))
  createItemStore(db.connection, () => credential.masterKey).create({ type: 'password', title: 'original', password: 'secret', favorite: false })
  writeSettings(db.connection, { themeMode: 'dark', clipboardClearTimeout: 30, autoLockMinutes: 60 })
  const snapshot = createBackup(db.connection, credential.metadata, credential.masterKey)
  const parsed = await readBackup(snapshot, password)
  db.connection.exec("CREATE TRIGGER fail_restore BEFORE INSERT ON items BEGIN SELECT RAISE(ABORT, 'simulated disk failure'); END")
  assert.throws(() => restoreBackup(db.connection, parsed), /BACKUP_RESTORE_FAILED/)
  const current = JSON.parse(createBackup(db.connection, credential.metadata, credential.masterKey))
  assert.equal(decryptValue(credential.masterKey, current.payload), decryptValue(credential.masterKey, JSON.parse(snapshot).payload))
})
