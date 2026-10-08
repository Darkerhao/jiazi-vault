import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, readFileSync, rmSync, rmdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ts from 'typescript'
import { openDatabase } from '../dist-electron/database.js'
import { createItemStore } from '../dist-electron/item-store.js'
import { createProjectStore } from '../dist-electron/project-store.js'
import { backupRevision } from '../dist-electron/backup-status.js'
import { exportPlaintext, readPlaintext } from '../dist-electron/transfer.js'
import { DEFAULT_SEARCH_SHORTCUT, readSearchShortcut, writeSearchShortcut, validateSearchShortcut } from '../dist-electron/settings.js'

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'keystill-operations-'))
  const { connection: db, path } = openDatabase(directory), key = Buffer.alloc(32, 8)
  t.after(() => { key.fill(0); db.close(); rmSync(path); rmdirSync(directory) })
  return { db, key, items: createItemStore(db, () => key), projects: createProjectStore(db) }
}

test('batch editing is atomic, preserves secrets and records history only for changes', (t) => {
  const { db, items, projects } = fixture(t)
  const a = items.create({ type: 'login', title: 'A', password: 'a-secret', favorite: true })
  const b = items.create({ type: 'login', title: 'B', password: 'b-secret' })
  const group = projects.create({ name: 'Group' })
  const before = backupRevision(db)
  assert.throws(() => items.batch([a.id, 'missing'], { type: 'project', projectId: group.id }), /ITEM_NOT_FOUND/)
  assert.equal(items.get(a.id).projectId, undefined)
  assert.equal(items.listHistory(a.id).length, 0)
  assert.equal(backupRevision(db), before)
  assert.equal(items.batch([a.id, a.id, b.id], { type: 'project', projectId: group.id }), 2)
  assert.equal(items.get(a.id).favorite, true)
  assert.equal(items.get(a.id).password, 'a-secret')
  assert.equal(items.listHistory(a.id).length, 1)
  assert.equal(items.getHistory(a.id, items.listHistory(a.id)[0].id).projectId, undefined)
  assert.equal(items.batch([a.id, b.id], { type: 'project', projectId: group.id }), 0)
  assert.equal(items.listHistory(a.id).length, 1)
  assert.equal(items.batch([a.id, b.id], { type: 'project', projectId: null }), 2)
})

test('batch validation rolls back earlier environment edits and trash operations', (t) => {
  const { items } = fixture(t)
  const a = items.create({ type: 'login', title: 'A', environment: 'production' })
  const b = items.create({ type: 'env', title: 'B', environment: 'production', fields: { TOKEN: 'secret' } })
  assert.throws(() => items.batch([a.id, b.id], { type: 'environment', environment: null }), /ENVIRONMENT_REQUIRED/)
  assert.equal(items.get(a.id).environment, 'production')
  assert.equal(items.listHistory(a.id).length, 0)
  assert.equal(items.batch([a.id, b.id], { type: 'environment', environment: 'testing' }), 2)
  assert.throws(() => items.batch([a.id, 'missing'], { type: 'trash' }), /ITEM_NOT_FOUND/)
  assert.equal(items.list().length, 2)
  assert.equal(items.batch([a.id, b.id], { type: 'trash' }), 2)
  assert.throws(() => items.batch([a.id, b.id], { type: 'environment', environment: 'production' }), /ITEM_STATE_CHANGED/)
  assert.equal(items.batch([a.id, b.id], { type: 'restore' }), 2)
  assert.equal(items.get(b.id).fields.TOKEN, 'secret')
  for (const [ids, action] of [[[], { type: 'trash' }], [[a.id], { type: 'project', projectId: '' }], [[a.id], { type: 'environment', environment: 'invalid' }], [[a.id], { type: 'delete' }]]) {
    assert.throws(() => items.batch(ids, action), /INVALID_DATA/)
  }
})

for (const format of ['json', 'csv']) test(`${format} scoped export includes only the requested active records`, (t) => {
  const { db, key, items, projects } = fixture(t)
  const project = projects.create({ name: 'Selected project' })
  const a = items.create({ type: 'login', title: 'A', password: 'a-secret', projectId: project.id })
  const b = items.create({ type: 'login', title: 'B', password: 'b-secret' })
  const trashed = items.create({ type: 'login', title: 'Trash', projectId: project.id })
  items.remove(trashed.id)
  const scoped = exportPlaintext(db, key, format, { kind: 'project', projectId: project.id })
  assert.deepEqual(readPlaintext(scoped, format).map((item) => item.title), ['A'])
  assert.ok(!scoped.includes('b-secret'))
  assert.deepEqual(readPlaintext(exportPlaintext(db, key, format, { kind: 'items', ids: [b.id, b.id] }), format).map((item) => item.title), ['B'])
  assert.throws(() => exportPlaintext(db, key, format, { kind: 'items', ids: [a.id, trashed.id] }), /EXPORT_ITEMS_CHANGED/)
  assert.throws(() => exportPlaintext(db, key, format, { kind: 'items', ids: [] }), /INVALID_EXPORT_SCOPE/)
  assert.throws(() => exportPlaintext(db, key, format, { kind: 'unknown' }), /INVALID_EXPORT_SCOPE/)
})

test('device shortcut validates, persists and can be disabled', (t) => {
  const { db } = fixture(t)
  assert.equal(readSearchShortcut(db), DEFAULT_SEARCH_SHORTCUT)
  writeSearchShortcut(db, 'CommandOrControl+Shift+Y')
  assert.equal(readSearchShortcut(db), 'CommandOrControl+Shift+Y')
  writeSearchShortcut(db, null)
  assert.equal(readSearchShortcut(db), null)
  assert.throws(() => validateSearchShortcut('CommandOrControl+Shift+C'), /RESERVED_SHORTCUT/)
  for (const value of ['', 'Ctrl+C', 'CommandOrControl+C', 'CommandOrControl+Alt+F99', undefined, 5]) assert.throws(() => validateSearchShortcut(value), /INVALID_SHORTCUT/)
  assert.equal(readSearchShortcut(db), null)
})

test('search ranks exact and title-prefix matches ahead of metadata matches before applying the limit', async () => {
  const compile = (path) => ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
  const url = (text) => `data:text/javascript;base64,${Buffer.from(text).toString('base64')}`
  const fieldUrl = url(compile('../src/utils/item-fields.ts'))
  const { searchItems, createSearchIndex } = await import(url(compile('../src/utils/search.ts').replace("'./item-fields'", JSON.stringify(fieldUrl))))
  const items = Array.from({ length: 55 }, (_, i) => ({ id: String(i), title: `Other ${i}`, username: 'TARGET', type: 'login' }))
  items.push({ id: 'prefix', title: 'target service', type: 'login' }, { id: 'exact', title: 'TARGET', type: 'login' })
  const index = createSearchIndex(items, [])
  const results = searchItems(items, ' target ', index, 50)
  assert.deepEqual(results.slice(0, 2).map((item) => item.id), ['exact', 'prefix'])
  assert.equal(results.length, 50)
  assert.equal(searchItems(items, 'target', index).length, 57)
  assert.equal(searchItems(items, 'target service', index)[0].id, 'prefix')
  assert.deepEqual(searchItems(items, 'not found', index), [])
})
