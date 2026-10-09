import type { AppUpdater } from 'electron-updater'

export const RELEASE_PAGE = 'https://github.com/Darkerhao/jiazi-vault/releases/latest'
const RELEASE_API = 'https://api.github.com/repos/Darkerhao/jiazi-vault/releases/latest'

export interface AppUpdate {
  version: string
  newer: boolean
  notes: string
}

export interface UpdateState {
  automatic: boolean
  status: 'idle' | 'checking' | 'downloading' | 'installing' | 'current' | 'available' | 'error'
  update: AppUpdate | null
  percent: number
  error: string
}

export function createAppUpdates(
  updater: AppUpdater | null,
  checkRelease: () => Promise<AppUpdate | null>,
  notify: (state: UpdateState) => void,
  beforeInstall: () => void,
) {
  let state: UpdateState = { automatic: !!updater, status: 'idle', update: null, percent: 0, error: '' }
  const publish = (patch: Partial<UpdateState>) => { state = { ...state, ...patch }; notify(state) }
  function fail(cause: unknown) {
    const message = String(cause)
    const error = /UPDATE_RATE_LIMITED|\b(403|429)\b/.test(message)
      ? '检查过于频繁，请稍后重试，或直接打开官方下载页。'
      : message.includes('VAULT_BUSY')
        ? '保险库操作尚未完成，请完成后重试更新。'
        : /sha512|checksum|ERR_UPDATER_INVALID_SIGNATURE/i.test(message)
          ? '安装包校验失败，已停止安装，请重试更新。'
          : state.status === 'downloading'
            ? '下载更新失败，请检查网络后重试，或打开官方下载页。'
            : state.status === 'installing'
              ? '无法启动安装程序，请重试更新，或打开官方下载页。'
              : '暂时无法检查更新，请检查网络后重试，或直接打开官方下载页。'
    publish({ status: 'error', error })
  }
  if (updater) {
    // One operation owns checking, verified downloading and installation.
    updater.autoDownload = false
    updater.autoInstallOnAppQuit = false
    updater.autoRunAppAfterInstall = false // The finish-page checkbox owns launching.
    updater.allowPrerelease = false
    updater.allowDowngrade = false
    updater.disableWebInstaller = true
    updater.on('download-progress', ({ percent }) => publish({ percent: Math.round(percent) }))
    // Check/download errors reject their promise; installation errors only emit an event.
    updater.on('error', (error) => { if (state.status === 'installing') fail(error) })
  }
  return {
    get state() { return state },
    async check() {
      if (['checking', 'downloading', 'installing'].includes(state.status)) return state
      publish({ status: 'checking', update: null, percent: 0, error: '' })
      try {
        if (!updater) {
          const update = await checkRelease()
          publish({ update, status: update?.newer ? 'available' : 'current' })
        } else {
          const result = await updater.checkForUpdates()
          if (!result) throw new Error('UPDATE_UNAVAILABLE')
          const notes = result.updateInfo.releaseNotes
          const update = {
            version: result.updateInfo.version,
            newer: result.isUpdateAvailable,
            notes: (typeof notes === 'string' ? notes : notes?.map((note) => note.note).join('\n\n')) || '此版本暂无更新说明。',
          }
          publish({ update, status: update.newer ? 'downloading' : 'current' })
          if (update.newer) {
            await updater.downloadUpdate()
            beforeInstall()
            publish({ status: 'installing', percent: 100 })
            updater.quitAndInstall(false, false)
          }
        }
      } catch (cause) { fail(cause) }
      return state
    },
  }
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
