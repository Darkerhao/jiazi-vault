import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, rmSync, rmdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase } from '../dist-electron/database.js'
import { UnlockLimiter } from '../dist-electron/unlock-limiter.js'

test('unlock failures persist across restarts, back off from 30s to 15min and reset on success', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 })
  const dir = mkdtempSync(join(tmpdir(), 'jiazi-rate-'))
  let db = openDatabase(dir)
  t.after(() => { db.connection.close(); rmSync(db.path); rmdirSync(dir) })
  let limiter = new UnlockLimiter(db.connection)
  for (let i = 0; i < 4; i++) assert.equal(limiter.fail(), 0)
  assert.equal(limiter.fail(), Date.now() + 30_000)
  db.connection.close()
  db = openDatabase(dir)
  limiter = new UnlockLimiter(db.connection)
  assert.equal(limiter.retryAt, Date.now() + 30_000)
  for (const delay of [60_000, 120_000, 240_000, 480_000, 900_000, 900_000]) {
    t.mock.timers.setTime(limiter.retryAt)
    assert.equal(limiter.retryAt, 0)
    assert.equal(limiter.fail(), Date.now() + delay)
  }
  limiter.reset()
  assert.equal(limiter.retryAt, 0)
  assert.equal(limiter.fail(), 0)
})
