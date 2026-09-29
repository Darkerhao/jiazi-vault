import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'

const script = resolve('scripts/prepare-release.mjs')
const testRoot = resolve('output/release-tests')
const manifest = '{\n  "name": "release-test",\n  "version": "0.1.2",\n  "build": { "files": ["dist/**"] }\n}\n'

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
