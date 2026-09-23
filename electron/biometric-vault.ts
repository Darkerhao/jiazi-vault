import type { DatabaseSync } from 'node:sqlite'
import { clearKey, verifyVaultKey, type VaultMetadata } from './vault-crypto.js'
import type { BiometricStatus } from './contracts.js'

export interface BiometricProvider {
  label: BiometricStatus['label']
  available(): Promise<boolean>
  verify(): Promise<void>
  protect(key: Buffer): Promise<Buffer>
  unprotect(encrypted: Buffer): Promise<Buffer>
}

/** The persisted key is OS-encrypted and never leaves the main process. */
export class BiometricVault {
  constructor(private readonly db: DatabaseSync, private readonly provider: BiometricProvider) {}

  async status(): Promise<BiometricStatus> {
    return {
      label: this.provider.label,
      available: await this.provider.available(),
      enabled: Boolean(this.db.prepare('SELECT 1 FROM vault_metadata WHERE key = ?').get('biometric')),
    }
  }

  async prepare(key: Buffer): Promise<string> {
    if (!await this.provider.available()) throw new Error('BIOMETRIC_UNAVAILABLE')
    await this.provider.verify()
    return (await this.provider.protect(key)).toString('base64')
  }

  save(encrypted: string) {
    this.db.prepare('INSERT OR REPLACE INTO vault_metadata (key, value) VALUES (?, ?)').run('biometric', encrypted)
  }

  disable() { this.db.prepare('DELETE FROM vault_metadata WHERE key = ?').run('biometric') }

  async unlock(metadata: VaultMetadata): Promise<Buffer> {
    const row = this.db.prepare('SELECT value FROM vault_metadata WHERE key = ?').get('biometric')
    if (!row || !await this.provider.available()) throw new Error('BIOMETRIC_UNAVAILABLE')
    await this.provider.verify()
    const key = await this.provider.unprotect(Buffer.from(String(row.value), 'base64'))
    if (!verifyVaultKey(metadata, key)) {
      clearKey(key)
      throw new Error('BIOMETRIC_INVALID')
    }
    return key
  }
}
