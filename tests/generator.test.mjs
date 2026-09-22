import assert from 'node:assert/strict'
import { test } from 'node:test'
import { generatePassword } from '../dist-electron/password-generator.js'

const defaults = { length: 20, uppercase: true, lowercase: true, numbers: true, symbols: true, excludeAmbiguous: true }

test('all selected groups are present, excluded characters absent, and output stays within bounds', () => {
  const samples = new Set()
  for (let mask = 1; mask < 16; mask++) {
    const enabled = ['uppercase', 'lowercase', 'numbers', 'symbols'].map((key, i) => [key, !!(mask & (1 << i))])
    for (const length of [8, 20, 128]) {
      for (const excludeAmbiguous of [true, false]) {
        const options = { ...defaults, ...Object.fromEntries(enabled), length, excludeAmbiguous }
        const result = generatePassword(options)
        assert.equal(result.password.length, length)
        for (const [key, pattern] of [['uppercase', /[A-Z]/], ['lowercase', /[a-z]/], ['numbers', /\d/], ['symbols', /[^a-zA-Z0-9]/]]) {
          assert.equal(pattern.test(result.password), options[key])
        }
        if (excludeAmbiguous) assert.doesNotMatch(result.password, /[0O1Il|]/)
        assert.ok(Number.isFinite(result.entropy) && result.entropy > 0)
        samples.add(result.password)
      }
    }
  }
  assert.equal(samples.size, 90)
})

test('entropy and strength match the generated alphabet rather than length alone', () => {
  const digits = generatePassword({ ...defaults, length: 8, uppercase: false, lowercase: false, symbols: false, excludeAmbiguous: false })
  assert.equal(digits.entropy, 8 * Math.log2(10))
  assert.equal(digits.strength, '弱')
  assert.equal(generatePassword(defaults).strength, '非常强')
  for (const patch of [{ length: null }, { length: 7 }, { length: 129 }, { length: 8.5 }, { uppercase: 'true' }, { uppercase: false, lowercase: false, numbers: false, symbols: false }]) {
    assert.throws(() => generatePassword({ ...defaults, ...patch }), /INVALID_GENERATOR_OPTIONS/)
  }
})
