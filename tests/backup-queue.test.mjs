import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createBackupQueue } from '../dist-electron/backup-queue.js'

test('concurrent saves share one backup and callers wait for its completion', async () => {
  let runs = 0
  const queue = createBackupQueue(async () => { runs++ })
  const first = queue.request(), second = queue.request()
  assert.equal(first, second)
  assert.equal(runs, 0)
  await queue.drain()
  assert.equal(runs, 1)
})

test('a save during file output gets another backup before the queue drains', async () => {
  let runs = 0, finish, started
  const running = new Promise(resolve => { started = resolve })
  const queue = createBackupQueue(async () => {
    runs++
    if (runs === 1) { started(); await new Promise(resolve => { finish = resolve }) }
  })
  const first = queue.request()
  await running
  const second = queue.request()
  finish()
  await Promise.all([first, second, queue.drain()])
  assert.equal(runs, 2)
})

test('a failed backup releases the queue for the next request', async () => {
  let fail = true
  const queue = createBackupQueue(async () => { if (fail) throw new Error('disk failure') })
  await assert.rejects(queue.request(), /disk failure/)
  fail = false
  await queue.request()
})
