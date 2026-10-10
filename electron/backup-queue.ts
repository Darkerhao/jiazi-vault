/** Coalesces concurrent saves and waits for changes made during a backup as well. */
export function createBackupQueue(run: () => Promise<void>) {
  let pending: Promise<void> | null = null
  let requested = false
  return {
    request() {
      requested = true
      pending ??= new Promise<void>(resolve => setTimeout(resolve, 100)).then(async () => {
        do {
          requested = false
          await run()
        } while (requested)
      }).finally(() => { pending = null })
      return pending
    },
    drain() { return pending ?? Promise.resolve() },
  }
}
