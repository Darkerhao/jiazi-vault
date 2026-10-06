import { randomUUID } from 'node:crypto'
import { rename, rm, writeFile } from 'node:fs/promises'

/** Commit only a complete file, after checking the calling session is still valid. */
export async function writePrivateFile(path: string, contents: string, beforeCommit: () => void) {
  const temporaryPath = `${path}.${randomUUID()}.tmp`
  try {
    await writeFile(temporaryPath, contents, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    beforeCommit()
    await rename(temporaryPath, path)
  } finally { await rm(temporaryPath, { force: true }).catch(() => {}) }
}
