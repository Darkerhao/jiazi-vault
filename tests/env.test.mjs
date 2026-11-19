import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseEnv as parseNodeEnv } from 'node:util'
import { parseEnv, serializeEnv } from '../src/utils/env.ts'

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
