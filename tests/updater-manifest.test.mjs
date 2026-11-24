import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'

const collector = resolve('scripts/collect-packages.mjs')
const assembler = resolve('scripts/updater-manifest.mjs')
const builder = resolve('scripts/build-desktop.mjs')
const testRoot = resolve('output/publishing-tests')
function fixture(t) {
  mkdirSync(testRoot, { recursive: true })
  const root = mkdtempSync(join(testRoot, 'case-'))
  t.after(async () => { assert.equal(dirname(root), testRoot); await rm(root, { recursive: true, force: true }) })
  writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '0.1.19' }))
  return root
}
function run(script, args, cwd, signed = false) {
  return spawnSync(process.execPath, [script, ...args], { cwd, encoding: 'utf8', windowsHide: true, env: { ...process.env, TAURI_SIGNING_PRIVATE_KEY: signed ? 'unit-test-only' : '' } })
}
test('macOS updater archives from two architectures retain unique filenames and matching signatures', t => {
  const root = fixture(t)
  for (const [target, platform] of [['x86_64-apple-darwin', 'darwin-x86_64'], ['aarch64-apple-darwin', 'darwin-aarch64']]) {
    const bundle = join(root, 'src-tauri/target', target, 'release/bundle/macos')
    mkdirSync(bundle, { recursive: true })
    writeFileSync(join(bundle, 'Keystill.app.tar.gz'), `archive-${platform}`)
    writeFileSync(join(bundle, 'Keystill.app.tar.gz.sig'), `signature-${platform}`)
    const result = run(collector, [target, platform], root, true)
    assert.equal(result.status, 0, result.stderr)
    const manifest = JSON.parse(readFileSync(join(root, `release/updater-${platform}.json`), 'utf8'))
    assert.ok(manifest[platform].url.endsWith(`keystill-0.1.19-${platform}.app.tar.gz`))
    assert.equal(manifest[platform].signature, `signature-${platform}`)
  }
  assert.equal(readdirSync(join(root, 'release')).filter(file => file.endsWith('.app.tar.gz')).length, 2)
})
test('unsigned packages do not advertise automatic installation', t => {
  const root = fixture(t), bundle = join(root, 'src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis')
  mkdirSync(bundle, { recursive: true })
  writeFileSync(join(bundle, 'Keystill_0.1.19_x64-setup.exe'), 'installer fixture')
  assert.equal(run(collector, ['x86_64-pc-windows-msvc', 'windows-x86_64'], root).status, 0)
  writeFileSync(join(root, 'notes.md'), 'Release notes')
  assert.equal(run(assembler, ['release', 'v0.1.19', 'notes.md'], root).status, 0)
  assert.equal(readdirSync(join(root, 'release')).includes('tauri-updater.json'), false)
})
test('signed manifest assembly requires all four platform and architecture artifacts', t => {
  const root = fixture(t), release = join(root, 'release')
  mkdirSync(release)
  writeFileSync(join(root, 'notes.md'), 'Complete commit notes')
  const platforms = ['windows-x86_64', 'darwin-x86_64', 'darwin-aarch64', 'linux-x86_64']
  writeFileSync(join(release, 'updater-windows-x86_64.json'), JSON.stringify({ 'windows-x86_64': { url: 'fixture', signature: 'fixture' } }))
  assert.notEqual(run(assembler, ['release', 'v0.1.19', 'notes.md'], root).status, 0)
  for (const platform of platforms) writeFileSync(join(release, `updater-${platform}.json`), JSON.stringify({ [platform]: { url: `https://github.com/Darkerhao/jiazi-vault/releases/download/v0.1.19/${platform}`, signature: `fixture-${platform}` } }))
  const result = run(assembler, ['release', 'v0.1.19', 'notes.md'], root)
  assert.equal(result.status, 0, result.stderr)
  const manifest = JSON.parse(readFileSync(join(release, 'tauri-updater.json'), 'utf8'))
  assert.deepEqual(Object.keys(manifest.platforms).sort(), platforms.sort())
  assert.equal(manifest.version, '0.1.19')
  assert.equal(manifest.notes, 'Complete commit notes')
})
test('signed builds pass the updater public key into the Tauri build config', t => {
  const root = fixture(t)
  const cli = join(root, 'fake-cli.mjs')
  const capture = join(root, 'build-args.json')
  writeFileSync(cli, "import { writeFileSync } from 'node:fs'\nwriteFileSync(process.env.BUILD_ARGS, JSON.stringify(process.argv.slice(2)))\n")
  const result = spawnSync(process.execPath, [builder, '--bundles', 'nsis'], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    env: {
      ...process.env,
      npm_execpath: cli,
      BUILD_ARGS: capture,
      TAURI_SIGNING_PRIVATE_KEY: 'unit-test-only',
      TAURI_UPDATER_PUBLIC_KEY: 'public-key',
    },
  })
  assert.equal(result.status, 0, result.stderr)
  const args = JSON.parse(readFileSync(capture, 'utf8'))
  assert.deepEqual(args.slice(0, 4), ['exec', 'tauri', 'build', '--config'])
  const config = JSON.parse(args[4])
  assert.equal(config.bundle.createUpdaterArtifacts, true)
  assert.equal(config.plugins.updater.pubkey, 'public-key')
  assert.deepEqual(args.slice(5), ['--bundles', 'nsis'])
})
