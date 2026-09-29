import { execFileSync } from 'node:child_process'
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'

const branch = process.env.GITHUB_REF_NAME
const output = process.env.GITHUB_OUTPUT
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: 'pipe', windowsHide: true }).trim()

if (!branch || !output) throw new Error('GITHUB_REF_NAME and GITHUB_OUTPUT are required')
if (branch !== 'main') throw new Error('Automatic releases require the main branch')
if (git('branch', '--show-current') !== branch) throw new Error('Check out the release branch before preparing a version')
if (git('status', '--porcelain')) throw new Error('Release preparation requires a clean working tree')

const manifest = readFileSync('package.json', 'utf8')
let { version } = JSON.parse(manifest)
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Automatic releases require a stable major.minor.patch version')
let tag = `v${version}`

// A retry at the version commit must rebuild the same release.
if (!git('tag', '--points-at', 'HEAD', '--list', tag)) {
  const [major, minor, patch] = version.split('.')
  version = `${major}.${minor}.${Number(patch) + 1}`
  tag = `v${version}`
  if (git('tag', '--list', tag)) throw new Error(`Release tag ${tag} already exists`)

  writeFileSync('package.json', manifest.replace(/("version"\s*:\s*")[^"]+(")/, (_, prefix, suffix) => `${prefix}${version}${suffix}`))
  git('config', 'user.name', 'github-actions[bot]')
  git('config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com')
  git('add', '--', 'package.json')
  git('commit', '-m', `chore(release): ${tag}`)
  git('tag', '--annotate', tag, '--message', `Release ${tag}`)
}

// Reject concurrent branch/tag changes together; never force a version push.
git('push', '--atomic', 'origin', `HEAD:refs/heads/${branch}`, `refs/tags/${tag}`)
const commit = git('rev-parse', 'HEAD')
appendFileSync(output, `tag=${tag}\ncommit=${commit}\n`)
console.log(`Prepared ${tag} at ${commit}`)
