import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, rmSync, rmdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inspectCredentials } from '../dist-electron/credential-health.js'
import { openDatabase } from '../dist-electron/database.js'
import { createItemStore } from '../dist-electron/item-store.js'
import { backupRevision } from '../dist-electron/backup-status.js'

const now = new Date(2026, 9, 20, 12)

test('health reports short and reused passwords without returning secrets or conflating API keys', () => {
  const entries = inspectCredentials([
    { id: 'a', type: 'login', password: 'shared' },
    { id: 'b', type: 'database', password: 'shared' },
    { id: 'c', type: 'login', password: 'SHARED' },
    { id: 'd', type: 'api-key', fields: { apiKey: 'shared' } },
    { id: 'e', type: 'login', password: '汉'.repeat(12) },
    { id: 'f', type: 'login', password: '😀'.repeat(6) },
    { id: 'g', type: 'password', password: '' },
  ], now)
  assert.deepEqual(entries, [
    { id: 'a', issues: ['short-password', 'reused-password'] },
    { id: 'b', issues: ['short-password', 'reused-password'] },
    { id: 'c', issues: ['short-password'] },
    { id: 'f', issues: ['short-password'] },
  ])
  assert.ok(!JSON.stringify(entries).includes('shared'))
})

test('health uses existing local-date expiry rules and ignores dates outside API key entries', () => {
  const entries = inspectCredentials([
    { id: 'expired', type: 'api-key', fields: { expiresAt: '2026-10-19' } },
    { id: 'today', type: 'api-key', fields: { expiresAt: '2026-10-20' } },
    { id: 'week', type: 'api-key', fields: { expiresAt: '2026-10-27' } },
    { id: 'later', type: 'api-key', fields: { expiresAt: '2026-10-28' } },
    { id: 'invalid', type: 'api-key', fields: { expiresAt: '2026-02-30' } },
    { id: 'other', type: 'custom', fields: { expiresAt: '2026-10-19' } },
  ], now)
  assert.deepEqual(entries, [
    { id: 'expired', issues: ['expired'] },
    { id: 'today', issues: ['expiring'] },
    { id: 'week', issues: ['expiring'] },
    { id: 'invalid', issues: ['invalid-expiry'] },
  ])
})

test('store health excludes trash, has no access/history/backup side effects, and refreshes after edits', t => {
  const directory = mkdtempSync(join(tmpdir(), 'keystill-health-'))
  const { connection: db, path } = openDatabase(directory)
  const key = Buffer.alloc(32, 7)
  let locked = false
  const items = createItemStore(db, () => { if (locked) throw new Error('VAULT_LOCKED'); return key })
  t.after(() => { key.fill(0); db.close(); rmSync(path); rmdirSync(directory) })
  const a = items.create({ type: 'login', title: 'A', password: 'shared-password-123' })
  const b = items.create({ type: 'server', title: 'B', password: 'shared-password-123' })
  const trash = items.create({ type: 'password', title: 'Trash', password: 'short' })
  items.remove(trash.id)
  const revision = backupRevision(db)
  const result = items.checkHealth(now)
  assert.deepEqual(new Set(result.map(entry => entry.id)), new Set([a.id, b.id]))
  assert.ok(result.every(entry => entry.issues.length === 1 && entry.issues[0] === 'reused-password'))
  assert.equal(backupRevision(db), revision)
  assert.equal(items.get(a.id).lastAccessedAt, undefined)
  assert.equal(items.listHistory(a.id).length, 0)
  items.update({ ...items.get(b.id), password: 'a-different-password-456' })
  assert.deepEqual(items.checkHealth(now), [])
  locked = true
  assert.throws(() => items.checkHealth(now), /VAULT_LOCKED/)
})
