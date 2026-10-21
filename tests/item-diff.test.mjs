import assert from 'node:assert/strict'
import { test } from 'node:test'
import { diffItemHistory } from '../src/utils/item-history.ts'

const original = { id: 'one', type: 'env', title: 'Original', environment: 'testing', favorite: false, createdAt: 1, updatedAt: 1 }

test('history diff compares previous to saved content, including added/deleted empty and multiline fields', () => {
  const previous = { ...original, username: 'before', port: 0, fields: { TOKEN: 'old', REMOVED: '', SAME: '', MULTI: 'a\nb' } }
  const current = { ...original, title: 'Current', username: 'after', fields: { TOKEN: 'new', ADDED: '', SAME: '', MULTI: 'a\nc' } }
  const rows = diffItemHistory(previous, current)
  assert.deepEqual(rows.filter(row => row.kind !== 'unchanged').map(({ key, kind, before, after }) => ({ key, kind, before, after })), [
    { key: 'title', kind: 'changed', before: 'Original', after: 'Current' },
    { key: 'username', kind: 'changed', before: 'before', after: 'after' },
    { key: 'port', kind: 'removed', before: 0, after: undefined },
    { key: 'field:TOKEN', kind: 'changed', before: 'old', after: 'new' },
    { key: 'field:REMOVED', kind: 'removed', before: '', after: undefined },
    { key: 'field:MULTI', kind: 'changed', before: 'a\nb', after: 'a\nc' },
    { key: 'field:ADDED', kind: 'added', before: undefined, after: '' },
  ])
  assert.equal(rows.find(row => row.key === 'field:SAME').kind, 'unchanged')
  assert.deepEqual(previous.fields, { TOKEN: 'old', REMOVED: '', SAME: '', MULTI: 'a\nb' })
})

test('history diff includes restorable metadata, isolates custom names, and excludes usage/favorite timestamps', () => {
  const previous = { ...original, tags: ['a、b'], fields: Object.fromEntries([['title', 'secret-title'], ['__proto__', 'old']]) }
  const current = { ...previous, type: 'custom', projectId: 'project', environment: undefined, tags: ['a', 'b'], favorite: true, updatedAt: 2, lastAccessedAt: 3,
    fields: Object.fromEntries([['title', 'secret-title'], ['__proto__', 'new'], ['constructor', '']]) }
  assert.deepEqual(diffItemHistory(previous, current).filter(row => row.kind !== 'unchanged').map(row => [row.key, row.kind]), [
    ['type', 'changed'], ['projectId', 'added'], ['environment', 'removed'], ['tags', 'changed'], ['field:__proto__', 'changed'], ['field:constructor', 'added'],
  ])
  assert.equal(diffItemHistory(previous, current).find(row => row.key === 'field:title').kind, 'unchanged')
  assert.deepEqual(diffItemHistory(original, { ...original, favorite: true, updatedAt: 5, tags: [] }).filter(row => row.kind !== 'unchanged'), [])
})
