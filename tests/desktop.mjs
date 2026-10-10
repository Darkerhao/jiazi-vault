import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// OS authentication and physical lock/suspend still require user participation.
const scripts = ['electron-smoke', 'credentials-smoke', 'access-smoke', 'unlock-preference', 'env-smoke', 'desktop-regression', 'product-experience', 'creation-shortcuts', 'data-recovery', 'app-update', 'operation-experience', 'startup-settings', 'workflow-reliability']
const requested = process.argv.slice(2)
if (requested.some((name) => !scripts.includes(name))) throw new Error(`Choose from: ${scripts.join(', ')}`)

for (const name of requested.length ? requested : scripts) {
  console.log(`Running ${name}`)
  const code = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [fileURLToPath(new URL(`./${name}.mjs`, import.meta.url))], {
      cwd: fileURLToPath(new URL('..', import.meta.url)), stdio: 'inherit', windowsHide: true,
    })
    child.on('error', reject)
    child.on('exit', (code) => resolve(code ?? 1))
  })
  if (code !== 0) { process.exitCode = code; break }
}
