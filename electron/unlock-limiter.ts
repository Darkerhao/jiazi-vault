import type { DatabaseSync } from 'node:sqlite'

export class UnlockLimiter {
  constructor(private readonly db: DatabaseSync) {}

  get retryAt(): number {
    const row = this.db.prepare('SELECT retry_at FROM unlock_attempts WHERE id = 1').get()
    return row && Number(row.retry_at) > Date.now() ? Number(row.retry_at) : 0
  }

  fail() {
    const row = this.db.prepare('SELECT failures FROM unlock_attempts WHERE id = 1').get()
    const failures = Math.min(Number(row?.failures ?? 0) + 1, 10)
    const retryAt = failures < 5 ? 0 : Date.now() + Math.min(30_000 * 2 ** (failures - 5), 900_000)
    this.db.prepare('INSERT OR REPLACE INTO unlock_attempts (id, failures, retry_at) VALUES (1, ?, ?)').run(failures, retryAt)
    return retryAt
  }

  reset() { this.db.exec('DELETE FROM unlock_attempts') }
}
