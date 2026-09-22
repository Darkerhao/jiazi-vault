import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, rmSync, rmdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase } from '../dist-electron/database.js'
import { createProjectStore } from '../dist-electron/project-store.js'
import { createItemStore } from '../dist-electron/item-store.js'
import { createVaultCredential, encryptValue, decryptValue, clearKey } from '../dist-electron/vault-crypto.js'
import { createBackup, readBackup, restoreBackup } from '../dist-electron/backup.js'

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'jiazi-projects-'))
  const db = openDatabase(dir)
  const key = Buffer.alloc(32, 5)
  t.after(() => { clearKey(key); db.connection.close(); rmSync(db.path); rmdirSync(dir) })
  return { db: db.connection, projects: createProjectStore(db.connection), items: createItemStore(db.connection, () => key) }
}

test('project CRUD, validation, access, active count and deletion preserve credentials', (t) => {
  const { db, projects, items } = fixture(t)
  const project = projects.create({ name: '  Work  ', icon: '💻', color: '#123456', description: 'test' })
  assert.equal(project.name, 'Work')
  assert.equal(project.itemCount, 0)
  assert.throws(() => projects.create({ name: 'work' }), /PROJECT_NAME_EXISTS/)
  for (const input of [{ name: ' ' }, { name: 'x', color: 'red' }, { name: 'x', description: 'a'.repeat(501) }]) assert.throws(() => projects.create(input), /INVALID_PROJECT/)
  const active = items.create({ type: 'password', title: 'active', password: 'secret', projectId: project.id, environment: 'production', favorite: true })
  const trash = items.create({ type: 'password', title: 'trash', password: 'trash-secret', projectId: project.id, favorite: false })
  items.remove(trash.id)
  assert.equal(projects.list()[0].itemCount, 1)
  assert.ok(projects.visit(project.id).lastAccessedAt > 0)
  assert.equal(projects.update({ id: project.id, name: 'Renamed' }).name, 'Renamed')
  projects.remove(project.id)
  assert.equal(projects.list().length, 0)
  assert.equal(items.get(active.id).projectId, undefined)
  assert.equal(items.get(active.id).password, 'secret')
  assert.equal(items.get(active.id).environment, 'production')
  assert.equal(items.list(true)[0].projectId, undefined)
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM items').get().count, 2)
  assert.throws(() => items.create({ type: 'password', title: 'bad', projectId: project.id }), /PROJECT_NOT_FOUND/)
})

test('a failed project deletion rolls back item detachment', (t) => {
  const { db, projects, items } = fixture(t)
  const project = projects.create({ name: 'Keep' })
  const item = items.create({ type: 'password', title: 'Keep', projectId: project.id, favorite: false })
  db.exec("CREATE TRIGGER block_delete BEFORE DELETE ON projects BEGIN SELECT RAISE(ABORT, 'test failure'); END")
  assert.throws(() => projects.remove(project.id), /PROJECT_DELETE_FAILED/)
  assert.equal(items.get(item.id).projectId, project.id)
  assert.equal(projects.list().length, 1)
})

test('version 1 restores without projects; version 2 rejects orphan and duplicate projects', async (t) => {
  const { db, projects } = fixture(t)
  const credential = await createVaultCredential('backup-project-password')
  t.after(() => clearKey(credential.masterKey))
  db.prepare('INSERT INTO vault_metadata VALUES (?, ?)').run('vault', JSON.stringify(credential.metadata))
  const project = projects.create({ name: 'Source' })
  const items = createItemStore(db, () => credential.masterKey)
  items.create({ type: 'password', title: 'Item', projectId: project.id, favorite: false })
  const envelope = JSON.parse(createBackup(db, credential.metadata, credential.masterKey))
  const payload = JSON.parse(decryptValue(credential.masterKey, envelope.payload))
  for (const mutate of [(p) => { p.projects.push(p.projects[0]) }, (p) => { p.projects[0].name = '' }, (p) => { p.items[0].project_id = 'missing' }]) {
    const altered = structuredClone(payload)
    mutate(altered)
    await assert.rejects(readBackup(JSON.stringify({ ...envelope, payload: encryptValue(credential.masterKey, JSON.stringify(altered)) }), 'backup-project-password'), /BACKUP_PASSWORD_OR_DATA_INVALID/)
  }
  assert.equal(projects.list().length, 1)
  delete payload.projects
  const v1 = { ...envelope, version: 1, payload: encryptValue(credential.masterKey, JSON.stringify(payload)) }
  restoreBackup(db, await readBackup(JSON.stringify(v1), 'backup-project-password'))
  assert.equal(projects.list().length, 0)
  assert.equal(items.list()[0].projectId, undefined)
})
