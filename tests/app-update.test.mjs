import assert from 'node:assert/strict'
import { test } from 'node:test'
import { EventEmitter } from 'node:events'
import { checkForUpdates, createAppUpdates, getRecentReleases, UPDATE_CHECK_INTERVAL } from '../dist-electron/app-update.js'

const release = (tag_name, extra = {}) => ({ tag_name, draft: false, prerelease: false, body: 'Release notes', ...extra })
const reply = (body, status = 200) => async () => new Response(JSON.stringify(body), { status })

function fixture() {
  const updater = new EventEmitter(), calls = [], states = []
  updater.checkForUpdates = async () => {
    calls.push('check')
    return { isUpdateAvailable: true, updateInfo: { version: '1.2.0', releaseNotes: 'Notes' } }
  }
  updater.downloadUpdate = async () => {
    calls.push('download')
    updater.emit('download-progress', { percent: 42.4 })
  }
  updater.quitAndInstall = (...args) => calls.push(['install', ...args])
  const service = createAppUpdates(updater, () => { throw new Error('unexpected manual check') }, state => states.push(state), () => { calls.push('prepare'); return true })
  return { updater, calls, states, service }
}

test('detection never downloads; only explicit installation downloads and launches once', async () => {
  const f = fixture()
  assert.deepEqual(f.calls, [])
  assert.equal(f.updater.autoInstallOnAppQuit, false)
  assert.equal(f.updater.autoRunAppAfterInstall, false)
  assert.equal(f.updater.allowDowngrade, false)
  await f.service.check()
  assert.deepEqual(f.calls, ['check'])
  assert.equal(f.service.state.status, 'available')
  await f.service.install()
  assert.deepEqual(f.calls, ['check', 'download', 'prepare', ['install', false, false]])
  assert.ok(f.states.some(state => state.status === 'downloading' && state.percent === 42))
  assert.equal(f.service.state.status, 'installing')
  await f.service.check()
  await f.service.install()
  assert.equal(f.calls.length, 4)
})

test('concurrent checks cannot start another download or installer', async () => {
  const f = fixture()
  let finish
  f.updater.downloadUpdate = () => new Promise(resolve => { finish = resolve })
  await f.service.check()
  const pending = f.service.install()
  await Promise.resolve()
  assert.equal((await f.service.check()).status, 'downloading')
  assert.equal((await f.service.install()).status, 'downloading')
  assert.deepEqual(f.calls, ['check'])
  finish()
  await pending
  assert.deepEqual(f.calls, ['check', 'prepare', ['install', false, false]])
})

test('installation waits for draft confirmation; cancellation keeps the downloaded update ready for retry', async () => {
  const updater = new EventEmitter(), installs = []
  let confirm, downloads = 0
  updater.checkForUpdates = async () => ({ isUpdateAvailable: true, updateInfo: { version: '1.2.0' } })
  updater.downloadUpdate = async () => { downloads++ }
  updater.quitAndInstall = () => installs.push('install')
  const service = createAppUpdates(updater, async () => null, () => {}, () => new Promise(resolve => { confirm = resolve }))
  await service.check()
  const first = service.install()
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(installs, [])
  confirm(false)
  await first
  assert.equal(service.state.status, 'ready')
  assert.deepEqual(installs, [])
  await service.check(true)
  await service.check()
  assert.equal(service.state.status, 'ready')
  assert.deepEqual(installs, [])
  const retry = service.install()
  await new Promise(resolve => setImmediate(resolve))
  confirm(true)
  await retry
  assert.deepEqual(installs, ['install'])
  assert.equal(downloads, 1)
})

test('same or newer installed version never downloads or installs', async () => {
  const f = fixture()
  f.updater.checkForUpdates = async () => ({ isUpdateAvailable: false, updateInfo: { version: '0.1.0' } })
  await f.service.check()
  await f.service.install()
  assert.equal(f.service.state.status, 'current')
  assert.deepEqual(f.calls, [])
})

test('download and checksum failures never install; an explicit retry can recover', async () => {
  for (const message of ['offline', 'sha512 checksum mismatch']) {
    const f = fixture()
    f.updater.downloadUpdate = async () => {
      const error = new Error(message)
      f.updater.emit('error', error)
      throw error
    }
    await f.service.check()
    await f.service.install()
    assert.equal(f.service.state.status, 'error')
    assert.match(f.service.state.error, message === 'offline' ? /下载更新失败/ : /校验失败/)
    assert.deepEqual(f.calls, ['check'])
    f.updater.downloadUpdate = async () => []
    await f.service.install()
    assert.equal(f.service.state.status, 'installing')
  }
})

test('installer errors are reported and retry is not stuck in installing', async () => {
  const f = fixture()
  f.updater.quitAndInstall = () => f.updater.emit('error', new Error('spawn failed'))
  await f.service.check()
  await f.service.install()
  assert.equal(f.service.state.status, 'error')
  assert.match(f.service.state.error, /无法启动安装程序/)
})

test('an ongoing vault operation prevents installation after downloading', async () => {
  const f = fixture()
  const service = createAppUpdates(f.updater, async () => null, () => {}, () => { throw new Error('VAULT_BUSY') })
  await service.check()
  await service.install()
  assert.match(service.state.error, /保险库操作尚未完成/)
  assert.deepEqual(f.calls, ['check', 'download'])
})

test('unsupported builds still check release information without downloading', async () => {
  const service = createAppUpdates(null, async () => ({ version: '1.0.0', newer: true, notes: 'Notes' }), () => {}, () => assert.fail('unexpected install'))
  await service.check()
  await service.install()
  assert.equal(service.state.automatic, false)
  assert.equal(service.state.status, 'available')
})

test('background failures stay quiet and do not erase an already detected update', async () => {
  const f = fixture()
  f.updater.checkForUpdates = async () => { throw new Error('offline') }
  await f.service.check(true)
  assert.equal(f.service.state.status, 'idle')
  assert.equal(f.service.state.error, '')
  await f.service.check()
  assert.equal(f.service.state.status, 'error')
  f.updater.checkForUpdates = async () => ({ isUpdateAvailable: true, updateInfo: { version: '1.2.0' } })
  await f.service.check(true)
  assert.equal(f.service.state.update.newer, true)
  f.updater.checkForUpdates = async () => { throw new Error('offline') }
  await f.service.check(true)
  assert.equal(f.service.state.status, 'available')
  await f.service.check()
  assert.equal(f.service.state.status, 'error')
  assert.equal(f.service.state.update.newer, true)
  assert.deepEqual(f.calls, [])
})

test('startup checks immediately and every six hours; disposal stops future checks', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] })
  let checks = 0
  const service = createAppUpdates(null, async () => { checks++; return { version: `1.0.${checks}`, newer: true, notes: '' } }, () => {}, () => true)
  const stop = service.startChecking()
  t.after(stop)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(checks, 1)
  t.mock.timers.tick(UPDATE_CHECK_INTERVAL - 1)
  assert.equal(checks, 1)
  t.mock.timers.tick(1)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(checks, 2)
  assert.equal(service.state.update.version, '1.0.2')
  stop()
  t.mock.timers.tick(UPDATE_CHECK_INTERVAL)
  assert.equal(checks, 2)
})

test('recent releases exclude drafts and previews, sort versions numerically, and keep five complete notes', async () => {
  const entries = [release('v2.0.0', { draft: true }), release('v2.0.0-beta', { prerelease: true }),
    ...[8, 10, 9, 6, 7, 5].map(patch => release(`v1.0.${patch}`, { published_at: '2026-10-20T08:00:00Z', body: '- feat: 新功能\n\n  详细说明\n<script>untrusted</script>' }))]
  const releases = await getRecentReleases(async (url, options) => {
    assert.equal(url, 'https://api.github.com/repos/Darkerhao/jiazi-vault/releases?per_page=20')
    assert.equal(options.credentials, 'omit')
    assert.equal(options.redirect, 'error')
    assert.equal(options.body, undefined)
    return new Response(JSON.stringify(entries))
  })
  assert.deepEqual(releases.map(entry => entry.version), ['1.0.10', '1.0.9', '1.0.8', '1.0.7', '1.0.6'])
  assert.equal(releases[0].notes, entries[2].body)
  assert.equal(releases[0].tag, 'v1.0.10')
  assert.equal(releases[0].publishedAt, '2026-10-20T08:00:00Z')
})

test('recent releases distinguish empty history, rate limits and malformed responses', async () => {
  assert.deepEqual(await getRecentReleases(reply([])), [])
  assert.deepEqual(await getRecentReleases(reply({}, 404)), [])
  for (const status of [403, 429]) await assert.rejects(getRecentReleases(reply({}, status)), /UPDATE_RATE_LIMITED/)
  for (const data of [null, {}, [release('https://untrusted.invalid')], [release('v1.0.0', { body: {} })]]) {
    await assert.rejects(getRecentReleases(reply(data)), /INVALID_RELEASE/)
  }
})

test('update comparison uses numeric release versions and never offers a downgrade', async () => {
  for (const [current, latest, newer] of [['0.1.8', 'v0.1.10', true], ['0.9.9', 'v1.0.0', true], ['1.2.3', 'v1.2.3', false], ['1.10.0', 'v1.9.9', false]]) {
    assert.equal((await checkForUpdates(current, reply(release(latest)))).newer, newer)
  }
})

test('update request sends no local data and rejects redirects', async () => {
  await checkForUpdates('0.1.8', async (url, options) => {
    assert.equal(url, 'https://api.github.com/repos/Darkerhao/jiazi-vault/releases/latest')
    assert.equal(options.credentials, 'omit')
    assert.equal(options.redirect, 'error')
    assert.equal(options.body, undefined)
    assert.ok(options.signal instanceof AbortSignal)
    return new Response(JSON.stringify(release('v0.1.9')))
  })
})

test('missing release, rate limits and unavailable server remain distinguishable', async () => {
  assert.equal(await checkForUpdates('0.1.8', reply({}, 404)), null)
  for (const status of [403, 429]) await assert.rejects(checkForUpdates('0.1.8', reply({}, status)), /UPDATE_RATE_LIMITED/)
  await assert.rejects(checkForUpdates('0.1.8', reply({}, 503)), /UPDATE_CHECK_FAILED/)
  await assert.rejects(checkForUpdates('0.1.8', async () => { throw new TypeError('fetch failed') }), /fetch failed/)
})

test('untrusted release metadata must be a stable version with text notes', async () => {
  for (const value of [null, {}, release('v0.1.9-beta'), release('v01.2.3'), release('https://evil.invalid'), release('v1.2.3', { draft: true }), release('v1.2.3', { prerelease: true }), release('v1.2.3', { body: {} })]) {
    await assert.rejects(checkForUpdates('0.1.8', reply(value)), /INVALID_RELEASE/)
  }
  assert.equal((await checkForUpdates('0.1.8', reply(release('v1.0.0', { body: null })))).notes, '此版本暂无更新说明。')
})
