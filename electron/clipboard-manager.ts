import type { Clipboard } from 'electron'
import type { AppSettings } from './settings.js'

export class ClipboardManager {
  private ownedText: string | null = null
  private copiedAt = 0
  private timer: ReturnType<typeof setTimeout> | undefined
  private timerGeneration = 0
  private queue: Promise<void> = Promise.resolve()

  constructor(
    private readonly clipboard: Pick<Clipboard, 'readText' | 'writeText' | 'clear'>,
    private readonly timeout: () => AppSettings['clipboardClearTimeout'],
  ) {}

  private enqueue(operation: () => Promise<void>) {
    const result = this.queue.then(operation)
    this.queue = result.catch(() => {})
    return result
  }

  copy(text: string, assertUnlocked: () => void) {
    return this.enqueue(async () => {
      assertUnlocked()
      await this.clipboard.writeText(text)
      this.ownedText = text
      this.copiedAt = Date.now()
      this.reschedule()
    })
  }

  reschedule() {
    clearTimeout(this.timer)
    const generation = ++this.timerGeneration
    const seconds = this.timeout()
    if (this.ownedText !== null && seconds !== 'never') {
      const remaining = Math.max(0, seconds * 1000 - (Date.now() - this.copiedAt))
      this.timer = setTimeout(() => {
        void this.enqueue(async () => {
          if (generation === this.timerGeneration) await this.clearOwned()
        }).catch(() => {})
      }, remaining)
      this.timer.unref()
    }
  }

  private async clearOwned() {
    if (this.ownedText !== null && await this.clipboard.readText() === this.ownedText) this.clipboard.clear()
    this.ownedText = null
    this.timerGeneration++
    clearTimeout(this.timer)
  }

  clearOnLock() {
    // Run after pending writes, including a write interrupted by a lock event.
    return this.enqueue(() => this.clearOwned())
  }
}
