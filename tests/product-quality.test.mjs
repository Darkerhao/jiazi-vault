import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, rmSync, rmdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase } from '../dist-electron/database.js'
import { createItemStore } from '../dist-electron/item-store.js'
import { createProjectStore } from '../dist-electron/project-store.js'
import { backupRevision, readBackupStatus, recordBackup } from '../dist-electron/backup-status.js'
import { parseImport, previewImport, importReviewed, exportPlaintext } from '../dist-electron/transfer.js'
import { expiryState, validExpiry } from '../dist-electron/expiry.js'
import { writeSettings, DEFAULT_SETTINGS } from '../dist-electron/settings.js'

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'keystill-quality-'))
  const { connection: db, path } = openDatabase(dir)
  const key = Buffer.alloc(32, 7)
  t.after(() => { key.fill(0); db.close(); rmSync(path); rmdirSync(dir) })
  return { db, key, items: createItemStore(db, () => key), projects: createProjectStore(db) }
}

test('backup tracking is transactional, ignores usage, persists and preserves changes made during a backup write', (t) => {
  const { db, items, projects } = fixture(t)
  assert.equal(readBackupStatus(db).lastBackupAt, null)
  const project = projects.create({ name: 'Example' })
  const item = items.create({ type: 'login', title: 'Example', password: 'secret', projectId: project.id })
  recordBackup(db, backupRevision(db), 100)
  items.get(item.id, true)
  projects.visit(project.id)
  assert.deepEqual(readBackupStatus(db), { lastBackupAt: 100, hasChanges: false })
  const snapshot = backupRevision(db)
  items.toggleFavorite(item.id)
  recordBackup(db, snapshot, 200)
  assert.deepEqual(readBackupStatus(db), { lastBackupAt: 200, hasChanges: true })
  recordBackup(db, backupRevision(db))
  db.exec('BEGIN')
  items.remove(item.id)
  assert.equal(readBackupStatus(db).hasChanges, true)
  db.exec('ROLLBACK')
  assert.equal(readBackupStatus(db).hasChanges, false)
  writeSettings(db, DEFAULT_SETTINGS)
  assert.equal(readBackupStatus(db).hasChanges, true)
  recordBackup(db, backupRevision(db), 300)
  const path = db.prepare('PRAGMA database_list').get().file
  const { DatabaseSync } = process.getBuiltinModule('node:sqlite')
  const second = new DatabaseSync(path)
  try { assert.deepEqual(readBackupStatus(second), { lastBackupAt: 300, hasChanges: false }) }
  finally { second.close() }
})

test('expiry validates calendar dates and uses local end of day and a seven-day window', () => {
  assert.equal(validExpiry('2026-02-29'), false)
  assert.equal(validExpiry('2028-02-29'), true)
  assert.equal(validExpiry('2026-9-29'), false)
  const now = new Date(2026, 8, 29, 23, 59)
  assert.equal(expiryState('2026-09-28', now), 'expired')
  assert.equal(expiryState('2026-09-29', now), 'soon')
  assert.equal(expiryState('2026-10-06', now), 'soon')
  assert.equal(expiryState('2026-10-07', now), 'valid')
  assert.equal(expiryState('yesterday', now), 'invalid')
  assert.equal(expiryState(undefined, now), 'none')
})

test('expiry remains encrypted but its summary omits API secrets; invalid new dates are rejected', (t) => {
  const { db, items } = fixture(t)
  const item = items.create({ type: 'api-key', title: 'API', fields: { expiresAt: '2026-10-06', apiKey: 'not-in-summary' } })
  assert.equal(item.expiresAt, '2026-10-06')
  assert.equal(items.list()[0].fields, undefined)
  assert.ok(!JSON.stringify(items.list()).includes('not-in-summary'))
  assert.ok(!db.prepare('SELECT secret FROM items').get().secret.includes('2026-10-06'))
  assert.throws(() => items.create({ type: 'api-key', title: 'Bad', fields: { expiresAt: '2026-02-30' } }), /INVALID_EXPIRY/)
})

test('preview reports invalid records without secrets, skips exact duplicates but preserves changed credentials', (t) => {
  const { db, key, items } = fixture(t)
  items.create({ type: 'api-key', title: 'API', fields: { apiKey: 'secret-one', expiresAt: '2026-10-06' }, favorite: true })
  const records = parseImport(JSON.stringify([
    { type: 'api-key', title: 'API', fields: { expiresAt: '2026-10-06', apiKey: 'secret-one' }, favorite: false },
    { type: 'api-key', title: 'API', fields: { apiKey: 'secret-two', expiresAt: '2026-10-06' } },
    { type: 'api-key', title: 'API', fields: { expiresAt: '2026-10-06', apiKey: 'secret-two' } },
    { type: 'server', title: 'invalid', port: 70000, password: 'do-not-leak' },
  ]), 'json')
  const preview = previewImport(db, key, records)
  assert.equal(preview.validCount, 3)
  assert.equal(preview.duplicateCount, 2)
  assert.equal(preview.invalidCount, 1)
  assert.equal(preview.rows[3].row, 4)
  assert.ok(!JSON.stringify(preview).includes('secret-'))
  assert.ok(!JSON.stringify(preview).includes('do-not-leak'))
  assert.equal(importReviewed(db, key, records, true), 1)
  assert.equal(importReviewed(db, key, records, true), 0)
  assert.equal(items.list().length, 2)
  assert.equal(importReviewed(db, key, records, false), 3)
  for (const format of ['csv', 'json']) {
    const exported = parseImport(exportPlaintext(db, key, format), format)
    assert.equal(importReviewed(db, key, exported, true), 0)
  }
})

test('CSV record errors are isolated, and empty custom fields differ from missing fields', (t) => {
  const { db, key } = fixture(t)
  const csv = parseImport('type,title,port\nserver,valid,22\nserver,invalid,abc\n', 'csv')
  assert.equal(csv[0].item.port, 22)
  assert.equal(csv[1].row, 2)
  assert.ok(csv[1].error)
  const records = parseImport('[{"type":"custom","title":"same","fields":{"empty":""}},{"type":"custom","title":"same"}]', 'json')
  assert.equal(previewImport(db, key, records).duplicateCount, 0)
  assert.equal(importReviewed(db, key, records, true), 2)
})
