import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { GitHubProvider } from 'electron-updater/out/providers/GitHubProvider.js'

const require = createRequire(import.meta.url)
const builderRequire = createRequire(require.resolve('electron-builder'))
const { createUpdateInfoTasks, writeUpdateInfoFiles } = builderRequire('app-builder-lib/out/publish/updateInfoBuilder.js')
const { PlatformPackager } = builderRequire('app-builder-lib/out/platformPackager.js')
const { Platform } = builderRequire('app-builder-lib/out/core.js')

const script = resolve('scripts/prepare-release.mjs')
const notesScript = resolve('scripts/release-notes.mjs')
const testRoot = resolve('output/release-tests')
const manifest = '{\n  "name": "release-test",\n  "version": "0.1.2",\n  "type": "module",\n  "main": "dist-electron/main.js",\n  "build": { "files": ["dist/**"] }\n}\n'

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe', windowsHide: true }).trim()
}

function identity(cwd) {
  git(cwd, 'config', 'user.name', 'Release Test')
  git(cwd, 'config', 'user.email', 'release-test@example.invalid')
  git(cwd, 'config', 'commit.gpgsign', 'false')
  git(cwd, 'config', 'tag.gpgsign', 'false')
}

function fixture(t) {
  mkdirSync(testRoot, { recursive: true })
  const root = mkdtempSync(join(testRoot, 'case-'))
  t.after(async () => {
    assert.equal(dirname(root), testRoot)
    await rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 })
  })
  const remote = join(root, 'remote.git'), repo = join(root, 'repo'), output = join(root, 'github-output')
  git(root, 'init', '--bare', '--initial-branch=main', remote)
  git(root, 'clone', remote, repo)
  identity(repo)
  writeFileSync(join(repo, 'package.json'), manifest)
  git(repo, 'add', 'package.json')
  git(repo, 'commit', '-m', 'Initial source')
  git(repo, 'push', '-u', 'origin', 'main')
  return {
    root, repo, remote, output,
    run(cwd = repo, branch = 'main') {
      rmSync(output, { force: true })
      return spawnSync(process.execPath, [script], {
        cwd, encoding: 'utf8', windowsHide: true,
        env: { ...process.env, GITHUB_REF_NAME: branch, GITHUB_OUTPUT: output },
      })
    },
  }
}

function syncVersion(repo, commit) {
  const workflow = readFileSync(resolve('.github/workflows/build.yml'), 'utf8').replace(/\r\n/g, '\n')
  const job = workflow.split('\n  sync-dev:')[1]
  const commands = job.match(/        run: \|\r?\n((?:          [^\n]*(?:\n|$))+)/)[1].replace(/^          /gm, '')
  const bash = process.platform === 'win32' ? resolve(git(repo, '--exec-path'), '../../../bin/bash.exe') : 'bash'
  return spawnSync(bash, ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', commands], {
    cwd: repo, encoding: 'utf8', windowsHide: true,
    env: { ...process.env, RELEASE_COMMIT: commit },
  })
}

function releaseNotes(f, tag) {
  const file = join(f.root, 'release-notes.md')
  const result = spawnSync(process.execPath, [notesScript, tag, file], {
    cwd: f.repo, encoding: 'utf8', windowsHide: true,
  })
  assert.equal(result.status, 0, result.stderr)
  return readFileSync(file, 'utf8')
}

test('release notes list every commit and body between stable tags, including merged branch commits', (t) => {
  const f = fixture(t)
  git(f.repo, 'tag', 'v0.1.2')
  git(f.repo, 'switch', '-c', 'feature')
  git(f.repo, 'commit', '--allow-empty', '-m', 'feat: 添加启动设置', '-m', '支持开机启动。\n支持关闭后驻留托盘。')
  const feature = git(f.repo, 'rev-parse', '--short=7', 'HEAD')
  git(f.repo, 'switch', 'main')
  git(f.repo, 'merge', '--no-ff', 'feature', '-m', 'Merge startup settings')
  git(f.repo, 'tag', 'v0.1.3-beta')
  git(f.repo, 'commit', '--allow-empty', '-m', 'fix: 修复窗口显示')
  assert.equal(f.run().status, 0)
  const notes = releaseNotes(f, 'v0.1.3')
  assert.match(notes, /v0\.1\.2 → v0\.1\.3/)
  assert.ok(notes.includes(`- feat: 添加启动设置 (${feature})`))
  assert.match(notes, /  支持开机启动。\n  支持关闭后驻留托盘。/)
  assert.match(notes, /- Merge startup settings/)
  assert.match(notes, /- fix: 修复窗口显示/)
  assert.match(notes, /- chore\(release\): v0\.1\.3/)
  assert.equal(notes.split('\n').filter(line => line.startsWith('- ')).length, 4)
  assert.doesNotMatch(notes, /Initial source|Full Changelog|<p>|<a /)
  git(f.repo, 'commit', '--allow-empty', '-m', 'Future unreleased change')
  assert.equal(releaseNotes(f, 'v0.1.3'), notes)
})

test('first release notes contain the complete history and numeric version order selects the previous tag', (t) => {
  const f = fixture(t)
  git(f.repo, 'tag', 'v0.1.9')
  assert.match(releaseNotes(f, 'v0.1.9'), /首次发布[\s\S]*Initial source/)
  git(f.repo, 'commit', '--allow-empty', '-m', 'Version ten change')
  git(f.repo, 'tag', 'v0.1.10')
  git(f.repo, 'commit', '--allow-empty', '-m', 'Version eleven change')
  git(f.repo, 'tag', 'v0.1.11')
  const notes = releaseNotes(f, 'v0.1.11')
  assert.match(notes, /v0\.1\.10 → v0\.1\.11/)
  assert.match(notes, /Version eleven change/)
  assert.doesNotMatch(notes, /Version ten change|Initial source/)
})

test('build metadata carries the commit notes and the real GitHub updater prefers them over Atom HTML', async (t) => {
  const f = fixture(t)
  git(f.repo, 'tag', 'v0.1.2')
  const notes = releaseNotes(f, 'v0.1.2')
  const workflow = readFileSync(resolve('.github/workflows/build.yml'), 'utf8')
  const notesFile = workflow.match(/--config\.releaseInfo\.releaseNotesFile=(\S+)/)?.[1]
  assert.ok(notesFile, 'Packaging must embed the generated release notes')
  assert.doesNotMatch(workflow, /--generate-notes/)
  const destination = resolve(f.repo, notesFile)
  mkdirSync(dirname(destination), { recursive: true })
  writeFileSync(destination, notes)
  const packager = {
    projectDir: f.repo,
    info: { buildResourcesDir: join(f.repo, 'build') },
    resourceList: Promise.resolve([]),
    getResource: PlatformPackager.prototype.getResource,
    platform: Platform.WINDOWS,
    platformSpecificBuildOptions: {},
    config: { releaseInfo: { releaseNotesFile: notesFile } },
    appInfo: { version: '0.1.2' },
  }
  const tasks = await createUpdateInfoTasks({ packager, target: { outDir: f.root },
    file: join(f.root, 'setup.exe'), arch: 1, updateInfo: { sha512: 'fixture-checksum' },
  }, [{ provider: 'github', owner: 'Darkerhao', repo: 'jiazi-vault' }])
  await writeUpdateInfoFiles(tasks, { emitArtifactCreated: async () => {} })
  const metadata = readFileSync(join(f.root, 'latest.yml'), 'utf8')
  const html = '<p><strong>Full Changelog</strong>: <a href="https://github.com/Darkerhao/jiazi-vault/compare/v0.1.1...v0.1.2">v0.1.1...v0.1.2</a></p>'
  let channel = metadata
  const provider = new GitHubProvider({ provider: 'github', owner: 'Darkerhao', repo: 'jiazi-vault' }, {}, {
    platform: 'win32', executor: { request: async ({ path }) => {
      if (path.endsWith('.atom')) return `<feed><entry><title>Release</title><link href="https://github.com/Darkerhao/jiazi-vault/releases/tag/v0.1.2"/><content type="html"><![CDATA[${html}]]></content></entry></feed>`
      if (path.endsWith('/latest')) return JSON.stringify({ tag_name: 'v0.1.2' })
      assert.ok(path.endsWith('/latest.yml'))
      return channel
    } },
  })
  // Without embedded notes the previous pipeline reproduces the screenshot's HTML.
  channel = JSON.stringify({ version: '0.1.2', files: [] })
  assert.equal((await provider.getLatestVersion()).releaseNotes, html)
  channel = metadata
  assert.equal((await provider.getLatestVersion()).releaseNotes, notes)
})

test('release sync applies only the bot version commit to divergent dev and is safe to retry', (t) => {
  const f = fixture(t)
  git(f.repo, 'switch', '-c', 'dev')
  const devManifest = manifest.replace('dist/**', 'dev/**')
  writeFileSync(join(f.repo, 'package.json'), devManifest)
  writeFileSync(join(f.repo, 'feature.txt'), 'unreleased dev feature')
  git(f.repo, 'add', '.')
  git(f.repo, 'commit', '-m', 'Unreleased development')
  git(f.repo, 'push', '-u', 'origin', 'dev')
  const devHead = git(f.repo, 'rev-parse', 'HEAD')

  git(f.repo, 'switch', 'main')
  writeFileSync(join(f.repo, 'package.json'), manifest.replace('dist/**', 'main/**'))
  writeFileSync(join(f.repo, 'feature.txt'), 'different main feature')
  writeFileSync(join(f.repo, 'main-only.txt'), 'main only')
  git(f.repo, 'add', '.')
  git(f.repo, 'commit', '-m', 'Main source with conflicts against dev')
  const prepared = f.run()
  assert.equal(prepared.status, 0, prepared.stderr)
  const releaseCommit = git(f.repo, 'rev-parse', 'HEAD')

  git(f.repo, 'switch', 'dev')
  const result = syncVersion(f.repo, releaseCommit)
  assert.equal(result.status, 0, result.stderr)
  const syncedHead = git(f.remote, 'rev-parse', 'refs/heads/dev')
  assert.equal(git(f.repo, 'show', '-s', '--format=%P', syncedHead), devHead)
  assert.equal(git(f.repo, 'show', '-s', '--format=%an', syncedHead), 'github-actions[bot]')
  assert.equal(git(f.repo, 'show', '-s', '--format=%s', syncedHead), 'chore(release): v0.1.3')
  assert.equal(git(f.repo, 'diff', '--name-only', devHead, syncedHead), 'package.json')
  assert.equal(git(f.remote, 'show', 'refs/heads/dev:package.json'), devManifest.replace('0.1.2', '0.1.3').trim())
  assert.equal(git(f.remote, 'rev-parse', 'refs/heads/main'), releaseCommit)

  const retry = syncVersion(f.repo, releaseCommit)
  assert.equal(retry.status, 0, retry.stderr)
  assert.equal(git(f.remote, 'rev-parse', 'refs/heads/dev'), syncedHead)
  assert.equal(git(f.repo, 'rev-parse', 'HEAD'), syncedHead)
  assert.equal(git(f.repo, 'status', '--porcelain'), '')
})

test('dev cannot prepare a release or change the version, remote branch, or tags', (t) => {
  const f = fixture(t)
  git(f.repo, 'switch', '-c', 'dev')
  git(f.repo, 'push', '-u', 'origin', 'dev')
  const source = git(f.repo, 'rev-parse', 'HEAD')
  const result = f.run(f.repo, 'dev')
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /require the main branch/)
  assert.equal(readFileSync(join(f.repo, 'package.json'), 'utf8'), manifest)
  assert.equal(git(f.repo, 'status', '--porcelain'), '')
  assert.equal(git(f.repo, 'rev-parse', 'HEAD'), source)
  assert.equal(git(f.remote, 'rev-parse', 'refs/heads/main'), source)
  assert.equal(git(f.remote, 'rev-parse', 'refs/heads/dev'), source)
  assert.equal(git(f.repo, 'tag', '--list'), '')
  assert.equal(git(f.remote, 'tag', '--list'), '')
  assert.throws(() => readFileSync(f.output), /ENOENT/)
})

test('release increments only the patch, pushes matching source and tag, and reuses the version on retry', (t) => {
  const f = fixture(t)
  const source = git(f.repo, 'rev-parse', 'HEAD')
  const result = f.run()
  assert.equal(result.status, 0, result.stderr)
  const commit = git(f.remote, 'rev-parse', 'refs/heads/main')
  assert.equal(git(f.remote, 'rev-parse', 'v0.1.3^{commit}'), commit)
  assert.equal(git(f.remote, 'rev-parse', `${commit}^`), source)
  assert.equal(git(f.remote, 'show', 'v0.1.3:package.json'), manifest.replace('0.1.2', '0.1.3').trim())
  assert.equal(git(f.remote, 'show', '-s', '--format=%an', commit), 'github-actions[bot]')
  assert.equal(readFileSync(f.output, 'utf8'), `tag=v0.1.3\ncommit=${commit}\n`)

  const retryRepo = join(f.root, 'retry')
  git(f.root, 'clone', f.remote, retryRepo)
  const retry = f.run(retryRepo)
  assert.equal(retry.status, 0, retry.stderr)
  assert.equal(git(f.remote, 'rev-parse', 'refs/heads/main'), commit)
  assert.equal(git(f.remote, 'tag', '--list'), 'v0.1.3')
  assert.equal(git(f.repo, 'status', '--porcelain'), '')
})

test('a later source push advances to the next version and preserves the previous release', (t) => {
  const f = fixture(t)
  assert.equal(f.run().status, 0)
  const previous = git(f.remote, 'rev-parse', 'v0.1.3^{commit}')
  writeFileSync(join(f.repo, 'feature.txt'), 'new feature')
  git(f.repo, 'add', 'feature.txt')
  git(f.repo, 'commit', '-m', 'Add feature')
  git(f.repo, 'push')
  const result = f.run()
  assert.equal(result.status, 0, result.stderr)
  assert.equal(git(f.remote, 'show', 'v0.1.4:feature.txt'), 'new feature')
  assert.equal(JSON.parse(git(f.remote, 'show', 'v0.1.4:package.json')).version, '0.1.4')
  assert.equal(git(f.remote, 'rev-parse', 'v0.1.3^{commit}'), previous)
})

test('an existing next-version tag is rejected without changing source or overwriting the tag', (t) => {
  const f = fixture(t)
  const source = git(f.repo, 'rev-parse', 'HEAD')
  git(f.repo, 'tag', 'v0.1.3')
  git(f.repo, 'push', 'origin', 'v0.1.3')
  const result = f.run()
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /already exists/)
  assert.equal(readFileSync(join(f.repo, 'package.json'), 'utf8'), manifest)
  assert.equal(git(f.repo, 'status', '--porcelain'), '')
  assert.equal(git(f.remote, 'rev-parse', 'v0.1.3^{commit}'), source)
})

test('a concurrent user push rejects the version push atomically without publishing a mismatched tag', (t) => {
  const f = fixture(t)
  const peer = join(f.root, 'peer')
  git(f.root, 'clone', f.remote, peer)
  identity(peer)
  writeFileSync(join(peer, 'later.txt'), 'concurrent source')
  git(peer, 'add', 'later.txt')
  git(peer, 'commit', '-m', 'Concurrent user change')
  git(peer, 'push')
  const remoteHead = git(f.remote, 'rev-parse', 'refs/heads/main')
  const result = f.run()
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /rejected|failed to push/)
  assert.equal(git(f.remote, 'rev-parse', 'refs/heads/main'), remoteHead)
  assert.equal(git(f.remote, 'tag', '--list'), '')
  assert.throws(() => readFileSync(f.output), /ENOENT/)
})

test('uncommitted work is rejected before creating a version commit', (t) => {
  const f = fixture(t)
  const source = git(f.repo, 'rev-parse', 'HEAD')
  writeFileSync(join(f.repo, 'package.json'), manifest.replace('0.1.2', '0.2.0'))
  const result = f.run()
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /clean working tree/)
  assert.equal(git(f.repo, 'rev-parse', 'HEAD'), source)
  assert.equal(JSON.parse(readFileSync(join(f.repo, 'package.json'), 'utf8')).version, '0.2.0')
  assert.equal(git(f.remote, 'tag', '--list'), '')
})
