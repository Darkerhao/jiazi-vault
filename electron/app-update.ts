import type { AppUpdater } from 'electron-updater'

export const RELEASE_PAGE = 'https://github.com/Darkerhao/jiazi-vault/releases/latest'
const RELEASE_API = 'https://api.github.com/repos/Darkerhao/jiazi-vault/releases'
export const RELEASE_TAG = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/
export const UPDATE_CHECK_INTERVAL = 6 * 60 * 60 * 1000
type FetchRelease = (url: string, options: RequestInit) => Promise<Response>

export interface AppRelease {
  tag: string
  version: string
  notes: string
  publishedAt: string | null
}

export interface AppUpdate {
  version: string
  newer: boolean
  notes: string
}

export interface UpdateState {
  automatic: boolean
  status: 'idle' | 'checking' | 'downloading' | 'confirming' | 'ready' | 'installing' | 'current' | 'available' | 'error'
  update: AppUpdate | null
  percent: number
  error: string
}

export function createAppUpdates(
  updater: AppUpdater | null,
  checkRelease: () => Promise<AppUpdate | null>,
  notify: (state: UpdateState) => void,
  beforeInstall: () => boolean | Promise<boolean>,
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
    // Detection never downloads; installation requires a separate user action.
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
  async function installDownloaded() {
    publish({ status: 'confirming', percent: 100, error: '' })
    if (!await beforeInstall()) { publish({ status: 'ready' }); return }
    publish({ status: 'installing' })
    updater!.quitAndInstall(false, false)
  }
  async function check(silent = false): Promise<UpdateState> {
    if (['checking', 'downloading', 'confirming', 'ready', 'installing'].includes(state.status)) return state
    const previous = state
    publish({ status: 'checking', error: '' })
    try {
      let update: AppUpdate | null
      if (!updater) update = await checkRelease()
      else {
        const result = await updater.checkForUpdates()
        if (!result) throw new Error('UPDATE_UNAVAILABLE')
        const notes = result.updateInfo.releaseNotes
        update = {
          version: result.updateInfo.version,
          newer: result.isUpdateAvailable,
          notes: (typeof notes === 'string' ? notes : notes?.map((note) => note.note).join('\n\n')) || '此版本暂无更新说明。',
        }
      }
      publish({ update, status: update?.newer ? 'available' : 'current', percent: 0 })
    } catch (cause) {
      if (silent) publish(previous)
      else fail(cause)
    }
    return state
  }
  return {
    get state() { return state },
    check,
    startChecking() {
      void check(true)
      const timer = setInterval(() => { void check(true) }, UPDATE_CHECK_INTERVAL)
      timer.unref()
      return () => clearInterval(timer)
    },
    async install() {
      if (!updater || !state.update?.newer || ['checking', 'downloading', 'confirming', 'installing'].includes(state.status)) return state
      try {
        if (state.status !== 'ready') {
          publish({ status: 'downloading', percent: 0, error: '' })
          await updater.downloadUpdate()
        }
        await installDownloaded()
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

// Only public release metadata is requested; no vault data enters the request.
async function fetchReleaseData(path: string, fetchRelease: FetchRelease): Promise<unknown> {
  const response = await fetchRelease(`${RELEASE_API}${path}`, {
    headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    signal: AbortSignal.timeout(10_000),
    redirect: 'error',
    credentials: 'omit',
  })
  if (response.status === 404) return undefined
  if (response.status === 403 || response.status === 429) throw new Error('UPDATE_RATE_LIMITED')
  if (!response.ok) throw new Error('UPDATE_CHECK_FAILED')
  return response.json()
}

function parseRelease(release: unknown): AppRelease {
  if (!release || typeof release !== 'object' || !('tag_name' in release)
    || typeof release.tag_name !== 'string' || !RELEASE_TAG.test(release.tag_name)
    || !('draft' in release) || release.draft !== false
    || !('prerelease' in release) || release.prerelease !== false
    || !('body' in release) || (release.body !== null && typeof release.body !== 'string')) throw new Error('INVALID_RELEASE')
  const version = release.tag_name.replace(/^v/, '')
  versionParts(version)
  return {
    tag: release.tag_name, version, notes: release.body || '此版本暂无更新说明。',
    publishedAt: 'published_at' in release && typeof release.published_at === 'string' && Number.isFinite(Date.parse(release.published_at)) ? release.published_at : null,
  }
}

export async function checkForUpdates(currentVersion: string, fetchRelease: FetchRelease = fetch): Promise<AppUpdate | null> {
  const current = versionParts(currentVersion)
  const data = await fetchReleaseData('/latest', fetchRelease)
  if (data === undefined) return null
  const { version, notes } = parseRelease(data)
  const latest = versionParts(version)
  const difference = latest.findIndex((part, index) => part !== current[index])
  return {
    version,
    newer: difference !== -1 && latest[difference]! > current[difference]!,
    notes,
  }
}

export async function getRecentReleases(fetchRelease: FetchRelease = fetch): Promise<AppRelease[]> {
  const data = await fetchReleaseData('?per_page=20', fetchRelease)
  if (data === undefined) return []
  if (!Array.isArray(data)) throw new Error('INVALID_RELEASE')
  return data.filter((release) => release && release.draft === false && release.prerelease === false)
    .map(parseRelease)
    .sort((a, b) => {
      const left = versionParts(a.version), right = versionParts(b.version)
      for (let index = 0; index < 3; index++) if (left[index] !== right[index]) return right[index]! - left[index]!
      return 0
    }).slice(0, 5)
}
