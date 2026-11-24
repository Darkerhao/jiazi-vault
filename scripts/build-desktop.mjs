import { spawnSync } from 'node:child_process'

const signing = !!process.env.TAURI_SIGNING_PRIVATE_KEY
const publicKey = process.env.TAURI_UPDATER_PUBLIC_KEY?.trim()
if (signing !== !!publicKey) throw new Error('Configure TAURI_SIGNING_PRIVATE_KEY and TAURI_UPDATER_PUBLIC_KEY together, or omit both for manual-update packages.')
const cli = process.env.npm_execpath
if (!cli) throw new Error('Run this script through pnpm desktop:build')
const args = [cli, 'exec', 'tauri', 'build']
if (signing) args.push('--config', JSON.stringify({
  bundle: { createUpdaterArtifacts: true },
  plugins: { updater: { pubkey: publicKey } },
}))
args.push(...process.argv.slice(2))
const result = spawnSync(process.execPath, args, {
  stdio: 'inherit', windowsHide: true,
})
if (result.error) throw result.error
process.exitCode = result.status ?? 1
