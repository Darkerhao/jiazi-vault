import assert from 'node:assert/strict'
import { test } from 'node:test'
import { diffEnvFields, parseEnv } from '../dist-electron/env.js'

test('env diff distinguishes new, changed and unchanged values without mutating the current set', () => {
  const current = { TOKEN: 'old-secret', EMPTY: '', MULTI: 'first\nsecond', KEEP: 'retained' }
  const { entries, issues } = parseEnv('TOKEN=new-secret\nEMPTY=\nMULTI="first\nsecond"\nNEW=\n')
  assert.deepEqual(issues, [])
  assert.deepEqual(diffEnvFields(current, entries), [
    { name: 'TOKEN', value: 'new-secret', line: 1, kind: 'changed', previous: 'old-secret' },
    { name: 'EMPTY', value: '', line: 2, kind: 'unchanged', previous: '' },
    { name: 'MULTI', value: 'first\nsecond', line: 3, kind: 'unchanged', previous: 'first\nsecond' },
    { name: 'NEW', value: '', line: 5, kind: 'added' },
  ])
  assert.deepEqual(current, { TOKEN: 'old-secret', EMPTY: '', MULTI: 'first\nsecond', KEEP: 'retained' })
})

test('env diff handles empty replacements, whitespace, case and object-property variable names exactly', () => {
  const current = Object.fromEntries([['TOKEN', 'secret'], ['SPACED', ' keep '], ['__proto__', 'before']])
  const { entries } = parseEnv("TOKEN=\ntoken=new\nSPACED='keep'\n__proto__=after\nconstructor=literal\n")
  const diff = diffEnvFields(current, entries)
  assert.deepEqual(diff.map(({ name, kind }) => [name, kind]), [
    ['TOKEN', 'changed'], ['token', 'added'], ['SPACED', 'changed'], ['__proto__', 'changed'], ['constructor', 'added'],
  ])
  assert.equal(diff[0].value, '')
  assert.equal(diff[3].previous, 'before')
})
