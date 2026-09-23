import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseEnv as parseNodeEnv } from 'node:util'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseEnv, serializeEnv } from '../dist-electron/env.js'
import { openDatabase } from '../dist-electron/database.js'
import { createItemStore } from '../dist-electron/item-store.js'
import { createProjectStore } from '../dist-electron/project-store.js'
import { createBackup, readBackup, restoreBackup } from '../dist-electron/backup.js'
import { createVaultCredential, clearKey } from '../dist-electron/vault-crypto.js'
import { replaceVaultPassword } from '../dist-electron/vault-password.js'
import { VaultSession } from '../dist-electron/vault-session.js'
import { exportPlaintext, readPlaintext, importPlaintext } from '../dist-electron/transfer.js'

const fieldsOf = (preview) => Object.fromEntries(preview.entries.map(({ name, value }) => [name, value]))
const source = '# comment\r\nEMPTY=\r\nexport API_KEY = token # note\r\nSPACES="  a  "\r\nHASH=\'a#b\'\r\nMULTI=\'first  \r\n second\'\r\nESCAPED="a\\nb"\r\nLITERAL=\'a\\nb\'\r\nJSON={"a":true}\r\nREF=${API_KEY}\r\nSHELL=$(whoami)\r\n'
const expected = { EMPTY: '', API_KEY: 'token', SPACES: '  a  ', HASH: 'a#b', MULTI: 'first  \n second', ESCAPED: 'a\nb', LITERAL: 'a\\nb', JSON: '{"a":true}', REF: '${API_KEY}', SHELL: '$(whoami)' }

test('Node DotEnv values: empty, quotes, comments, multiline whitespace, CRLF, literal references and export', () => {
  const preview = parseEnv(source)
  assert.deepEqual(preview.issues, [])
  assert.deepEqual(fieldsOf(preview), expected)
  assert.deepEqual(fieldsOf(parseEnv('\uFEFF' + source)), expected)
  assert.deepEqual(parseNodeEnv(source), expected)
  assert.equal(fieldsOf(parseEnv('A=   \nB=two')).A, '')
})

test('strict diagnostics preserve line numbers and never silently accept duplicates or malformed declarations', () => {
  const preview = parseEnv('A=one\n# note\nA=two\n1_BAD=secret\nNO_EQUALS\nB="one" trailing\nC=`shell`\nD="unterminated')
  assert.deepEqual(preview.issues.map((entry) => entry.line), [3, 4, 5, 6, 7, 8])
  assert.match(preview.issues[0].message, /第 1 行/)
  assert.equal(JSON.stringify(preview.issues).includes('secret'), false)
  assert.equal(parseEnv('A=\0').issues.length, 1)
})

test('export preserves exact values when parsed by both this importer and Node', () => {
  const fields = { ...expected, BOTH: `it's "quoted"`, DOUBLE: `it's # important`, START: '"starts with quote', NEWLINES: '\n\n', TABS: '\tvalue\t', BACKSLASH: 'C:\\new\\project' }
  const exported = serializeEnv(fields)
  assert.deepEqual(fieldsOf(parseEnv(exported)), fields)
  assert.deepEqual(parseNodeEnv(exported), fields)
  assert.equal(exported.includes('\r'), false)
})

test('unrepresentable values fail explicitly instead of changing secrets during export', () => {
  for (const value of [`both ' and " #`, `both ' and "\n`, `a'\\n#`, 'windows\rreturn', 'nul\0']) {
    assert.throws(() => serializeEnv({ TOKEN: value }), /变量 TOKEN 无法/)
  }
  assert.throws(() => serializeEnv({ 'INVALID-NAME': 'secret' }), /INVALID_ENV_FIELDS/)
})

test('dictionary-like variable names remain own properties without prototype mutation', () => {
  const fields = fieldsOf(parseEnv('__proto__=value\nconstructor=ctor\ntoString=text'))
  assert.equal(Object.hasOwn(fields, '__proto__'), true)
  assert.equal(fields.__proto__, 'value')
  assert.deepEqual(fieldsOf(parseEnv(serializeEnv(fields))), fields)
})

test('env sets survive encryption, edits, restart, trash, backup, password change and refuse reads after lock', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'jiazi-env-'))
  let database = openDatabase(directory)
  const credential = await createVaultCredential('env-test-master-password')
  const session = new VaultSession(() => null, () => {})
  await session.authenticate(async () => Buffer.from(credential.masterKey))
  const store = () => createItemStore(database.connection, () => session.requireKey())
  t.after(() => { session.dispose(); clearKey(credential.masterKey); database.connection.close(); rmSync(directory, { recursive: true, force: true }) })
  database.connection.prepare('INSERT INTO vault_metadata VALUES (?, ?)').run('vault', JSON.stringify(credential.metadata))
  const project = createProjectStore(database.connection).create({ name: 'Env project', icon: 'folder', color: '#123456' })
  const fields = { ...expected, TOKEN: 'test-sensitive-value-unique', __safe: '' }
  const summary = store().create({ type: 'env', title: 'Production', projectId: project.id, environment: 'production', fields, favorite: false })
  assert.equal(summary.fields, undefined)
  assert.equal(store().list()[0].fields, undefined)
  assert.equal(readFileSync(database.path).includes(Buffer.from(fields.TOKEN)), false)
  const secret = database.connection.prepare('SELECT secret FROM items WHERE id = ?').get(summary.id).secret
  assert.equal(secret.includes('TOKEN'), false)
  assert.equal(secret.includes(fields.TOKEN), false)
  const edited = { ...fields, TOKEN: 'edited-secret', EXTRA: 'a\nb' }
  store().update({ ...store().get(summary.id), fields: edited })
  database.connection.close()
  database = openDatabase(directory)
  assert.deepEqual(store().get(summary.id).fields, edited)
  const deleted = store().create({ type: 'env', title: 'Deleted', environment: 'testing', fields: { EMPTY: '' }, favorite: false })
  store().remove(deleted.id)
  const backup = createBackup(database.connection, credential.metadata, session.requireKey())
  store().remove(summary.id, true)
  restoreBackup(database.connection, await readBackup(backup, 'env-test-master-password'))
  assert.deepEqual(store().get(summary.id).fields, edited)
  assert.equal(store().list(true)[0].id, deleted.id)
  store().restore(deleted.id)
  assert.deepEqual(store().get(deleted.id).fields, { EMPTY: '' })
  const next = await createVaultCredential('next-env-master-password')
  t.after(() => clearKey(next.masterKey))
  replaceVaultPassword(database.connection, session.requireKey(), next)
  session.lock()
  assert.throws(() => store().get(summary.id), /VAULT_LOCKED/)
  await session.authenticate(async () => Buffer.from(next.masterKey))
  assert.deepEqual(store().get(summary.id).fields, edited)
  assert.deepEqual(fieldsOf(parseEnv(serializeEnv(store().get(summary.id).fields))), edited)
  createProjectStore(database.connection).remove(project.id)
  assert.equal(store().get(summary.id).projectId, undefined)
  store().update({ ...store().get(summary.id), title: 'Unassigned' })
  for (const format of ['json', 'csv']) {
    const contents = exportPlaintext(database.connection, session.requireKey(), format)
    const rows = readPlaintext(contents, format)
    assert.equal(importPlaintext(database.connection, session.requireKey(), rows), rows.length)
  }
  assert.throws(() => store().create({ type: 'env', title: 'Bad', environment: 'testing', fields: { 'bad-name': 'secret' } }), /INVALID_ENV_FIELDS/)
  assert.throws(() => store().create({ type: 'env', title: 'Missing environment', fields: { A: '' } }), /INVALID_DATA/)
})
