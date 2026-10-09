import assert from 'node:assert/strict'
import { test } from 'node:test'
import { EventEmitter } from 'node:events'
import { checkForUpdates, createAppUpdates } from '../dist-electron/app-update.js'

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
  const service = createAppUpdates(updater, () => { throw new Error('unexpected manual check') }, state => states.push(state), () => calls.push('prepare'))
  return { updater, calls, states, service }
}

test('an explicit check downloads first, reports progress, then opens the interactive installer once', async () => {
  const f = fixture()
  assert.deepEqual(f.calls, [])
  assert.equal(f.updater.autoInstallOnAppQuit, false)
  assert.equal(f.updater.autoRunAppAfterInstall, false)
  assert.equal(f.updater.allowDowngrade, false)
  await f.service.check()
  assert.deepEqual(f.calls, ['check', 'download', 'prepare', ['install', false, false]])
  assert.ok(f.states.some(state => state.status === 'downloading' && state.percent === 42))
  assert.equal(f.service.state.status, 'installing')
  await f.service.check()
  assert.equal(f.calls.length, 4)
})

test('concurrent checks cannot start another download or installer', async () => {
  const f = fixture()
  let finish
  f.updater.downloadUpdate = () => new Promise(resolve => { finish = resolve })
  const pending = f.service.check()
  await Promise.resolve()
  assert.equal((await f.service.check()).status, 'downloading')
  assert.deepEqual(f.calls, ['check'])
  finish()
  await pending
  assert.deepEqual(f.calls, ['check', 'prepare', ['install', false, false]])
})

test('same or newer installed version never downloads or installs', async () => {
  const f = fixture()
  f.updater.checkForUpdates = async () => ({ isUpdateAvailable: false, updateInfo: { version: '0.1.0' } })
  await f.service.check()
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
    assert.equal(f.service.state.status, 'error')
    assert.match(f.service.state.error, message === 'offline' ? /下载更新失败/ : /校验失败/)
    assert.deepEqual(f.calls, ['check'])
    f.updater.downloadUpdate = async () => []
    await f.service.check()
    assert.equal(f.service.state.status, 'installing')
  }
})

test('installer errors are reported and retry is not stuck in installing', async () => {
  const f = fixture()
  f.updater.quitAndInstall = () => f.updater.emit('error', new Error('spawn failed'))
  await f.service.check()
  assert.equal(f.service.state.status, 'error')
  assert.match(f.service.state.error, /无法启动安装程序/)
})

test('an ongoing vault operation prevents installation after downloading', async () => {
  const f = fixture()
  const service = createAppUpdates(f.updater, async () => null, () => {}, () => { throw new Error('VAULT_BUSY') })
  await service.check()
  assert.match(service.state.error, /保险库操作尚未完成/)
  assert.deepEqual(f.calls, ['check', 'download'])
})

test('unsupported builds still check release information without downloading', async () => {
  const service = createAppUpdates(null, async () => ({ version: '1.0.0', newer: true, notes: 'Notes' }), () => {}, () => assert.fail('unexpected install'))
  await service.check()
  assert.equal(service.state.automatic, false)
  assert.equal(service.state.status, 'available')
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
