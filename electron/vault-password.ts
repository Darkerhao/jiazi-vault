import type { DatabaseSync } from 'node:sqlite'
import { decryptValue, encryptValue, type CreatedVaultCredential } from './vault-crypto.js'

/** Metadata, all item ciphertexts and device unlock enrollment change atomically. */
export function replaceVaultPassword(db: DatabaseSync, oldKey: Buffer, credential: CreatedVaultCredential) {
  db.exec('BEGIN IMMEDIATE')
  try {
    const items = db.prepare('SELECT id, secret FROM items').all()
    const update = db.prepare('UPDATE items SET secret = ? WHERE id = ?')
    for (const item of items) {
      const plaintext = decryptValue(oldKey, JSON.parse(String(item.secret)))
      update.run(JSON.stringify(encryptValue(credential.masterKey, plaintext)), item.id)
    }
    const updateHistory = db.prepare('UPDATE item_history SET payload = ? WHERE id = ?')
    for (const row of db.prepare('SELECT id, payload FROM item_history').all()) {
      const plaintext = decryptValue(oldKey, JSON.parse(String(row.payload)))
      updateHistory.run(JSON.stringify(encryptValue(credential.masterKey, plaintext)), row.id)
    }
    db.prepare('UPDATE vault_metadata SET value = ? WHERE key = ?').run(JSON.stringify(credential.metadata), 'vault')
    db.prepare("DELETE FROM vault_metadata WHERE key IN ('biometric', 'biometric-preferred')").run()
    db.exec('DELETE FROM unlock_attempts; COMMIT')
  } catch {
    db.exec('ROLLBACK')
    throw new Error('PASSWORD_CHANGE_FAILED')
  }
}
