export const RELEASE_PAGE = 'https://github.com/Darkerhao/jiazi-vault/releases/latest'
const RELEASE_API = 'https://api.github.com/repos/Darkerhao/jiazi-vault/releases/latest'

export interface AppUpdate {
  version: string
  newer: boolean
  notes: string
}

function versionParts(version: string): number[] {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) throw new Error('INVALID_RELEASE')
  const parts = version.split('.').map(Number)
  if (!parts.every(Number.isSafeInteger)) throw new Error('INVALID_RELEASE')
  return parts
}

// Only this explicit user action contacts GitHub; no vault data enters the request.
export async function checkForUpdates(currentVersion: string, fetchRelease: (url: string, options: RequestInit) => Promise<Response> = fetch): Promise<AppUpdate | null> {
  const current = versionParts(currentVersion)
  const response = await fetchRelease(RELEASE_API, {
    headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    signal: AbortSignal.timeout(10_000),
    redirect: 'error',
    credentials: 'omit',
  })
  if (response.status === 404) return null
  if (response.status === 403 || response.status === 429) throw new Error('UPDATE_RATE_LIMITED')
  if (!response.ok) throw new Error('UPDATE_CHECK_FAILED')
  const release: unknown = await response.json()
  if (!release || typeof release !== 'object' || !('tag_name' in release)
    || typeof release.tag_name !== 'string' || !('draft' in release) || release.draft !== false
    || !('prerelease' in release) || release.prerelease !== false
    || !('body' in release) || (release.body !== null && typeof release.body !== 'string')) throw new Error('INVALID_RELEASE')
  const version = release.tag_name.replace(/^v/, '')
  const latest = versionParts(version)
  const difference = latest.findIndex((part, index) => part !== current[index])
  return {
    version,
    newer: difference !== -1 && latest[difference]! > current[difference]!,
    notes: release.body || '此版本暂无更新说明。',
  }
}
