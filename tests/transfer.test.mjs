import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, rmSync, rmdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase } from '../dist-electron/database.js'
import { createItemStore } from '../dist-electron/item-store.js'
import { createProjectStore } from '../dist-electron/project-store.js'
import { exportPlaintext, readPlaintext, importPlaintext } from '../dist-electron/transfer.js'

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'jiazi-transfer-'))
  const state = openDatabase(dir), key = Buffer.alloc(32, 7)
  t.after(() => { key.fill(0); state.connection.close(); rmSync(state.path); rmdirSync(dir) })
  return { db: state.connection, key, items: createItemStore(state.connection, () => key), projects: createProjectStore(state.connection) }
}

for (const format of ['json', 'csv']) test(`${format} round-trip preserves secrets, project, timestamps, multiline, quotes and excludes trash`, (t) => {
  const f = fixture(t)
  const project = f.projects.create({ name: 'Project 中文' })
  const input = { type: 'ssh', title: '=FORMULA()', projectId: project.id, environment: 'production', username: "'literal", password: '+secret', host: 'localhost', port: 22, notes: '\nline one, "quoted"\r\nline two', fields: { privateKey: 'key\r\nsecond\nthird', passphrase: '@secret' }, tags: ['one,two', '中文'], favorite: true }
  const item = f.items.create(input)
  f.items.markUsed(item.id)
  const trash = f.items.create({ type: 'password', title: 'trash', password: 'not-exported', favorite: false })
  f.items.remove(trash.id)
  const original = f.items.get(item.id)
  const text = exportPlaintext(f.db, f.key, format)
  assert.ok(!text.includes('not-exported'))
  if (format === 'csv') assert.ok(text.includes("\"'=FORMULA()\""))
  const rows = readPlaintext(text, format)
  assert.equal(rows.length, 1)
  assert.equal(importPlaintext(f.db, f.key, rows), 1)
  assert.equal(f.projects.list().length, 1)
  const copy = f.items.list().find((row) => row.id !== item.id)
  assert.deepEqual({ ...f.items.get(copy.id), id: item.id }, original)
  assert.equal(f.items.get(item.id).lastAccessedAt, original.lastAccessedAt)
  const stored = f.db.prepare('SELECT secret FROM items WHERE id = ?').get(copy.id)
  assert.ok(!stored.secret.includes('+secret'))
})

test('minimal files, header-only exports, BOM and reordered columns work', (t) => {
  const f = fixture(t)
  assert.deepEqual(readPlaintext(exportPlaintext(f.db, f.key, 'csv'), 'csv'), [])
  assert.deepEqual(readPlaintext('\uFEFF[{"type":"login","title":"sample"}]', 'json'), [{ type: 'login', title: 'sample', favorite: false }])
  const values = readPlaintext('title,type,project\r\nsample,login,New\r\n', 'csv')
  assert.equal(importPlaintext(f.db, f.key, values), 1)
  assert.equal(f.projects.list()[0].name, 'New')
  importPlaintext(f.db, f.key, readPlaintext('[{"title":"another","type":"login","project":"new"}]', 'json'))
  assert.equal(f.projects.list().length, 1)
})

test('invalid files are rejected without leaking their content', () => {
  const secret = 'private-value-not-for-error'
  const jsonInputs = [null, {}, [{ type: 'invalid', title: secret }], [{ type: 'login', title: '' }], [{ type: 'login', title: secret, password: 1 }], [{ type: 'login', title: secret, port: 65536 }], [{ type: 'login', title: secret, fields: { key: 1 } }], [{ type: 'login', title: secret, favorite: 'false' }], [{ type: 'login', title: secret, tags: [1] }], [{ type: 'login', title: secret, project: 1 }], [{ type: 'login', title: secret, lastAccessedAt: -1 }], [{ type: 'login', title: secret, extra: 'typo' }]]
  for (const value of jsonInputs) assert.throws(() => readPlaintext(JSON.stringify(value), 'json'), { message: 'INVALID_IMPORT' })
  for (const csv of ['type,title\nlogin', 'type,type,title\nlogin,login,sample', 'type,title\nlogin,"unclosed', 'type,title\nlogin,"closed"junk', 'type,title\nlogin,un"quoted', 'title\nmissing-type', 'type,title,port\nlogin,x,NaN']) {
    assert.throws(() => readPlaintext(csv, 'csv'), { message: 'INVALID_IMPORT' })
  }
})

test('invalid later row and database failure leave no partial items or projects', (t) => {
  const f = fixture(t)
  const keep = f.items.create({ type: 'password', title: 'keep', favorite: false })
  assert.throws(() => importPlaintext(f.db, f.key, [{ type: 'login', title: 'first', project: 'new' }, { type: 'unknown', title: 'bad' }]))
  assert.equal(f.projects.list().length, 0)
  f.db.exec("CREATE TRIGGER fail_import BEFORE INSERT ON items WHEN NEW.title = 'fail' BEGIN SELECT RAISE(ABORT, 'private database details'); END")
  assert.throws(() => importPlaintext(f.db, f.key, [{ type: 'login', title: 'first', project: 'new' }, { type: 'login', title: 'fail' }]), { message: 'IMPORT_FAILED' })
  assert.deepEqual(f.items.list().map((i) => i.id), [keep.id])
  assert.equal(f.projects.list().length, 0)
})

test('CSV apostrophe escapes are reversible for formula symbols and literal apostrophes', (t) => {
  const f = fixture(t)
  for (const value of ['=1+1', '+cmd', '-cmd', '@cmd', '\tdata', '\rdata', '\ndata', "'data", "''data", "'=literal"]) {
    f.items.create({ type: 'password', title: value, password: value, favorite: false })
  }
  const json = readPlaintext(exportPlaintext(f.db, f.key, 'json'), 'json')
  const csv = readPlaintext(exportPlaintext(f.db, f.key, 'csv'), 'csv')
  assert.deepEqual(csv, json)
})
