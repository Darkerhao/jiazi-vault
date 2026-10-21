import { createHash } from 'node:crypto'
import type { CredentialHealthEntry, VaultItem } from './contracts.js'
import { expiryState } from './expiry.js'

/** Local basic checks; secrets and their fingerprints never leave the main process. */
export function inspectCredentials(items: Iterable<Pick<VaultItem, 'id' | 'type' | 'password' | 'fields'>>, now = new Date()): CredentialHealthEntry[] {
  const results = new Map<string, CredentialHealthEntry>()
  const passwords = new Map<string, string>()
  for (const item of items) {
    const entry: CredentialHealthEntry = { id: item.id, issues: [] }
    results.set(item.id, entry)
    if (item.password) {
      if ([...item.password].length < 12) entry.issues.push('short-password')
      const fingerprint = createHash('sha256').update(item.password).digest('hex')
      const firstId = passwords.get(fingerprint)
      if (firstId !== undefined) {
        const first = results.get(firstId)!
        if (!first.issues.includes('reused-password')) first.issues.push('reused-password')
        entry.issues.push('reused-password')
      } else passwords.set(fingerprint, item.id)
    }
    if (item.type === 'api-key') {
      const state = expiryState(item.fields?.expiresAt, now)
      if (state === 'expired') entry.issues.push('expired')
      else if (state === 'soon') entry.issues.push('expiring')
      else if (state === 'invalid') entry.issues.push('invalid-expiry')
    }
  }
  return [...results.values()].filter(entry => entry.issues.length)
}
