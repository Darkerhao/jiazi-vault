import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, rmdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { openDatabase } from '../dist-electron/database.js'
import { createItemStore } from '../dist-electron/item-store.js'
import { createVaultCredential, clearKey } from '../dist-electron/vault-crypto.js'
import { createBackup, readBackup, restoreBackup } from '../dist-electron/backup.js'
import { readBackupStatus } from '../dist-electron/backup-status.js'
import { automaticBackupStatus, runAutomaticBackup, setAutomaticBackupDirectory, AUTOMATIC_BACKUP_INTERVAL } from '../dist-electron/automatic-backup.js'
import { createRecoverySnapshot, listRecoverySnapshots, readRecoverySnapshot } from '../dist-electron/recovery-snapshot.js'

async function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'keystill-reliability-'))
  const { connection: db } = openDatabase(directory)
  const credential = await createVaultCredential('reliability-fixture-password')
  db.prepare('INSERT INTO vault_metadata VALUES (?, ?)').run('vault', JSON.stringify(credential.metadata))
  const store = createItemStore(db, () => credential.masterKey)
  const item = store.create({ type: 'password', title: 'Current vault', password: 'private-current', favorite: false })
  t.after(() => {
    db.close(); clearKey(credential.masterKey)
    assert.equal(dirname(directory), tmpdir()); assert.ok(basename(directory).startsWith('keystill-reliability-'))
    rmSync(directory, { recursive: true, force: true })
  })
  return { directory, db, store, item, snapshot: () => createBackup(db, credential.metadata, credential.masterKey) }
}

test('automatic backup respects the interval and revision, detects missing files, preserves device configuration on restore', async (t) => {
  const f = await fixture(t), target = join(f.directory, 'backups'), now = 1_800_000_000_000
  assert.equal(await runAutomaticBackup(f.db, f.snapshot, () => {}, true, now), false)
  await setAutomaticBackupDirectory(f.db, target)
  assert.equal(await runAutomaticBackup(f.db, f.snapshot, () => {}, false, now), true)
  const [file] = readdirSync(target)
  const contents = readFileSync(join(target, file), 'utf8')
  assert.ok(!contents.includes('private-current'))
  assert.equal((await automaticBackupStatus(f.db)).fileExists, true)
  assert.equal(await runAutomaticBackup(f.db, f.snapshot, () => {}, false, now + AUTOMATIC_BACKUP_INTERVAL), false)
  f.store.update({ ...f.store.get(f.item.id), password: 'changed' })
  assert.equal(await runAutomaticBackup(f.db, f.snapshot, () => {}, false, now + 100), false)
  assert.equal(await runAutomaticBackup(f.db, f.snapshot, () => {}, false, now + AUTOMATIC_BACKUP_INTERVAL), true)
  const status = await automaticBackupStatus(f.db)
  const record = JSON.parse(f.db.prepare("SELECT value FROM settings WHERE key = 'automatic_backup_record'").get().value)
  rmSync(join(target, record.file))
  assert.equal((await automaticBackupStatus(f.db)).fileExists, false)
  assert.equal(await runAutomaticBackup(f.db, f.snapshot, () => {}, false, status.lastBackupAt + 1), true)
  const backup = await readBackup(contents, 'reliability-fixture-password')
  assert.equal(JSON.stringify(backup).includes(target), false)
  restoreBackup(f.db, backup)
  assert.equal((await automaticBackupStatus(f.db)).directory, target)
  assert.equal((await automaticBackupStatus(f.db)).lastBackupAt, null)
  await setAutomaticBackupDirectory(f.db, null)
  assert.equal(await runAutomaticBackup(f.db, f.snapshot, () => {}, true), false)
  assert.ok(readdirSync(target).length > 0)
})

test('automatic retention keeps ten owned files, and a failed write or lock never records a successful backup', async (t) => {
  const f = await fixture(t), target = join(f.directory, 'backups'), now = 1_800_000_000_000
  await setAutomaticBackupDirectory(f.db, target)
  writeFileSync(join(target, 'user-kept.jvault'), 'unrelated file')
  for (let index = 0; index < 12; index++) await runAutomaticBackup(f.db, f.snapshot, () => {}, true, now + index)
  assert.equal(readdirSync(target).filter((name) => name.startsWith('auto-')).length, 10)
  assert.equal(readFileSync(join(target, 'user-kept.jvault'), 'utf8'), 'unrelated file')
  const status = readBackupStatus(f.db), files = readdirSync(target)
  let checks = 0
  await assert.rejects(runAutomaticBackup(f.db, f.snapshot, () => { if (++checks === 2) throw new Error('VAULT_LOCKED') }, true, now + 100), /VAULT_LOCKED/)
  assert.deepEqual(readBackupStatus(f.db), status)
  assert.deepEqual(readdirSync(target), files)
  const empty = join(f.directory, 'removed-directory')
  await setAutomaticBackupDirectory(f.db, empty)
  rmdirSync(empty)
  await assert.rejects(runAutomaticBackup(f.db, f.snapshot, () => {}, true), /ENOENT/)
  assert.equal((await automaticBackupStatus(f.db)).error, true)
  assert.equal((await automaticBackupStatus(f.db)).lastBackupAt, null)
})

test('changes during file output remain unbacked and locking during directory setup preserves configuration', async (t) => {
  const f = await fixture(t), target = join(f.directory, 'backups')
  await setAutomaticBackupDirectory(f.db, target)
  let checks = 0
  await runAutomaticBackup(f.db, f.snapshot, () => {
    if (++checks === 2) f.store.update({ ...f.store.get(f.item.id), password: 'late-change' })
  }, true)
  assert.equal(readBackupStatus(f.db).hasChanges, true)
  await assert.rejects(setAutomaticBackupDirectory(f.db, join(f.directory, 'other'), () => { throw new Error('VAULT_LOCKED') }), /VAULT_LOCKED/)
  assert.equal((await automaticBackupStatus(f.db)).directory, target)
})

test('recovery snapshot is consistent, password protected, includes history, and can undo a replacement', async (t) => {
  const f = await fixture(t)
  f.db.exec('PRAGMA journal_mode = WAL')
  f.store.update({ ...f.store.get(f.item.id), password: 'new-value' })
  const id = createRecoverySnapshot(f.db, f.directory)
  assert.equal(listRecoverySnapshots(f.directory)[0].id, id)
  await assert.rejects(readRecoverySnapshot(f.directory, id, 'wrong-password'))
  await assert.rejects(readRecoverySnapshot(f.directory, '../vault.db', 'reliability-fixture-password'), /INVALID_SNAPSHOT/)
  const before = await readRecoverySnapshot(f.directory, id, 'reliability-fixture-password')
  f.store.remove(f.item.id, true)
  assert.equal(f.store.list().length, 0)
  restoreBackup(f.db, before)
  assert.equal(f.store.get(f.item.id).password, 'new-value')
  assert.equal(f.store.getHistory(f.item.id, f.store.listHistory(f.item.id)[0].id).password, 'private-current')
  assert.ok(!readFileSync(join(f.directory, 'recovery', id)).includes(Buffer.from('private-current')))
})

test('recovery snapshot failure leaves the current database untouched', async (t) => {
  const f = await fixture(t)
  writeFileSync(join(f.directory, 'recovery'), 'directory-blocker')
  assert.throws(() => createRecoverySnapshot(f.db, f.directory), /RECOVERY_SNAPSHOT_FAILED/)
  assert.equal(f.store.get(f.item.id).password, 'private-current')
})

test('an inaccessible backup location still exposes configuration so the user can change or disable it', async (t) => {
  const f = await fixture(t), target = join(f.directory, 'backups')
  await setAutomaticBackupDirectory(f.db, target)
  await runAutomaticBackup(f.db, f.snapshot, () => {}, true)
  renameSync(target, join(f.directory, 'kept'))
  writeFileSync(target, 'not a directory')
  await assert.rejects(runAutomaticBackup(f.db, f.snapshot, () => {}, true))
  const status = await automaticBackupStatus(f.db)
  assert.equal(status.directory, target)
  assert.equal(status.fileExists, false)
  assert.equal(status.error, true)
  await setAutomaticBackupDirectory(f.db, null)
  assert.equal((await automaticBackupStatus(f.db)).directory, null)
})
