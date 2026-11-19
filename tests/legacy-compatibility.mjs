import assert from 'node:assert/strict'
import { createDecipheriv } from 'node:crypto'
import { readFileSync } from 'node:fs'

// Independent Node implementation: verifies that Rust still writes the Electron wire format.
const fixture = JSON.parse(readFileSync(new URL('./fixtures/legacy.json', import.meta.url), 'utf8'))
const backup = JSON.parse(readFileSync(new URL('../output/compatibility/rust-v4.jvault', import.meta.url), 'utf8'))
const key = Buffer.from(fixture.key, 'base64')
function decrypt(value) {
  assert.equal(value.algorithm, 'AES-256-GCM')
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(value.nonce, 'base64'))
  decipher.setAuthTag(Buffer.from(value.authTag, 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(value.ciphertext, 'base64')), decipher.final()]).toString('utf8')
}
try {
  assert.equal(backup.format, 'jiazi-vault')
  assert.equal(backup.version, 4)
  assert.deepEqual(backup.metadata, fixture.metadata)
  assert.equal(decrypt(backup.metadata.verifier), 'jiazi-vault-verifier-v1')
  const payload = JSON.parse(decrypt(backup.payload))
  const current = payload.items.find(item => item.id === fixture.itemId)
  assert.equal(JSON.parse(decrypt(JSON.parse(current.secret))).password, 'written-by-rust-中文')
  const previous = payload.history.filter(row => row.item_id === fixture.itemId).map(row => JSON.parse(decrypt(JSON.parse(row.payload))))
  assert.ok(previous.some(item => item.password === 'fixture-secret-B'))
  assert.ok(previous.some(item => item.password === 'fixture-secret-A'))
  console.log('PASS original Electron fixtures → Rust → Node AES-GCM, current items and history')
} finally { key.fill(0) }
