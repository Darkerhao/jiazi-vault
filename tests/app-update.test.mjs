import assert from 'node:assert/strict'
import { test } from 'node:test'
import { checkForUpdates } from '../dist-electron/app-update.js'

const release = (tag_name, extra = {}) => ({ tag_name, draft: false, prerelease: false, body: 'Release notes', ...extra })
const reply = (body, status = 200) => async () => new Response(JSON.stringify(body), { status })

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
