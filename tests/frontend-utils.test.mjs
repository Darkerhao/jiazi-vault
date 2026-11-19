import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer } from 'vite'
import { validExpiry, expiryState } from '../src/utils/expiry.ts'
import { validateSearchShortcut, DEFAULT_SEARCH_SHORTCUT } from '../src/types/desktop.ts'

test('expiry uses calendar dates and local end of day', () => {
  assert.equal(validExpiry('2026-02-30'), false)
  assert.equal(validExpiry('2028-02-29'), true)
  assert.equal(expiryState('2026-11-19', new Date(2026, 10, 19, 23, 59)), 'soon')
  assert.equal(expiryState('2026-11-18', new Date(2026, 10, 19)), 'expired')
  assert.equal(expiryState('2026-12-01', new Date(2026, 10, 19)), 'valid')
})
test('device shortcut validation keeps reserved app actions available', () => {
  validateSearchShortcut(DEFAULT_SEARCH_SHORTCUT)
  validateSearchShortcut(null)
  assert.throws(() => validateSearchShortcut('CommandOrControl+Shift+L'), /RESERVED_SHORTCUT/)
  assert.throws(() => validateSearchShortcut('A'), /INVALID_SHORTCUT/)
})
test('search ranks exact titles ahead of metadata matches', async () => {
  const server = await createServer({ configFile: false, optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, watch: null } })
  try {
  const { createSearchIndex, searchItems } = await server.ssrLoadModule('/src/utils/search.ts')
  const items = [
    { id: 'metadata', type: 'login', title: 'Other', username: 'alpha', favorite: false, createdAt: 1, updatedAt: 1 },
    { id: 'prefix', type: 'login', title: 'Alpha service', favorite: false, createdAt: 1, updatedAt: 1 },
    { id: 'exact', type: 'login', title: 'Alpha', favorite: false, createdAt: 1, updatedAt: 1 },
  ]
  assert.equal(searchItems(items, 'alpha', createSearchIndex(items, []))[0].id, 'exact')
  } finally { await server.close() }
})
