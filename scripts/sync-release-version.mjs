import { execFileSync } from 'node:child_process'
import { writeVersion } from './release-version.mjs'

const commit = process.argv[2]
if (!commit) throw new Error('Usage: sync-release-version.mjs <release-commit>')

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: 'pipe', windowsHide: true }).trim()
const { version } = JSON.parse(git('show', `${commit}:package.json`))

writeVersion(version)
git('add', '--', 'package.json', 'src-tauri/Cargo.toml', 'src-tauri/Cargo.lock')
if (!git('status', '--porcelain')) {
  console.log(`dev already has version ${version}`)
  process.exit(0)
}

git('commit', '-m', `chore(release): v${version}`)
git('push', 'origin', 'HEAD:refs/heads/dev')
console.log(`Synced version ${version} to dev`)
