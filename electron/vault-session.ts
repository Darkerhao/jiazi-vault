import { clearKey } from './vault-crypto.js'

/** Owns the key and invalidates in-flight authentication whenever the vault locks. */
export class VaultSession {
  private key: Buffer | null = null
  private lastActivity = Date.now()
  private generation = 0
  private authenticating = false
  private timer: ReturnType<typeof setInterval>

  constructor(private readonly timeoutMinutes: () => number | null, private readonly onLock: () => void) {
    this.timer = setInterval(() => this.checkExpiry(), 1000)
    this.timer.unref()
  }

  get revision() { return this.generation }
  get unlocked() { this.checkExpiry(); return this.key !== null }

  requireKey() {
    this.checkExpiry()
    if (!this.key) throw new Error('VAULT_LOCKED')
    return this.key
  }

  checkExpiry() {
    const minutes = this.timeoutMinutes()
    if (this.key && minutes !== null && Date.now() - this.lastActivity >= minutes * 60_000) this.lock()
  }

  touch() {
    this.checkExpiry()
    this.lastActivity = Date.now()
  }

  lock() {
    this.generation++
    clearKey(this.key)
    this.key = null
    this.onLock()
  }

  async authenticate(derive: () => Promise<Buffer | null>, commit: () => void = () => {}) {
    if (this.authenticating) throw new Error('VAULT_BUSY')
    this.authenticating = true
    const revision = this.generation
    let key: Buffer | null = null
    try {
      key = await derive()
      if (revision !== this.generation) throw new Error('VAULT_LOCKED')
      if (!key) return false
      commit()
      clearKey(this.key)
      this.key = key
      key = null
      this.lastActivity = Date.now()
      return true
    } finally {
      clearKey(key)
      this.authenticating = false
    }
  }

  dispose() {
    clearInterval(this.timer)
    this.lock()
  }
}
