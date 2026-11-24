import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer } from 'vite'
import { validExpiry, expiryState } from '../src/utils/expiry.ts'
import { primaryLabel, primaryOptionLabel, primaryValueLabel } from '../src/utils/item-fields.ts'
import { normalizeExternalUrl } from '../src/utils/links.ts'
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
test('primary copy labels follow credential types', () => {
  assert.equal(primaryLabel('login'), '复制密码')
  assert.equal(primaryLabel('api-key'), '复制 API Key')
  assert.equal(primaryLabel('ssh'), '复制私钥')
  assert.equal(primaryLabel('env'), '复制 .env')
  assert.equal(primaryOptionLabel('env'), '完整 .env（需确认）')
  assert.equal(primaryValueLabel('api-key'), 'API Key')
})
test('credential URLs normalize bare hosts and reject explicit non-http schemes', () => {
  assert.equal(normalizeExternalUrl('example.com'), 'https://example.com/')
  assert.equal(normalizeExternalUrl('example.com:8080/admin'), 'https://example.com:8080/admin')
  assert.equal(normalizeExternalUrl('localhost:3000'), 'https://localhost:3000/')
  assert.equal(normalizeExternalUrl('http://example.com:8080/path'), 'http://example.com:8080/path')
  assert.equal(normalizeExternalUrl('https://example.com/a?b=1#c'), 'https://example.com/a?b=1#c')
  assert.equal(normalizeExternalUrl('javascript:alert(1)'), null)
  assert.equal(normalizeExternalUrl('mailto:user@example.com'), null)
  assert.equal(normalizeExternalUrl('file:///C:/secret'), null)
  assert.equal(normalizeExternalUrl('ftp://example.com'), null)
  assert.equal(normalizeExternalUrl('  '), null)
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
  const tieItems = [
    { id: 'recent', type: 'login', title: 'Alpha service', favorite: false, lastAccessedAt: 300, createdAt: 1, updatedAt: 1 },
    { id: 'older-favorite', type: 'login', title: 'Alpha service', favorite: true, lastAccessedAt: 100, createdAt: 1, updatedAt: 1 },
    { id: 'recent-favorite', type: 'login', title: 'Alpha service', favorite: true, lastAccessedAt: 200, createdAt: 1, updatedAt: 1 },
  ]
  assert.deepEqual(searchItems(tieItems, 'alpha', createSearchIndex(tieItems, [])).map((item) => item.id), ['recent-favorite', 'older-favorite', 'recent'])
  } finally { await server.close() }
})
