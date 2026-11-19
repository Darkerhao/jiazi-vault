import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const [target, platform] = process.argv.slice(2)
if (!/^[a-z0-9_-]+$/.test(target ?? '') || !/^(windows|darwin|linux)-(x86_64|aarch64)$/.test(platform ?? '')) throw new Error('Expected <Rust target> <updater platform-architecture>')
const { version } = JSON.parse(readFileSync('package.json', 'utf8'))
const root = resolve('src-tauri/target', target, 'release/bundle')
const output = resolve('release')
mkdirSync(output, { recursive: true })
function files(folder) {
  return readdirSync(folder).flatMap(name => {
    const path = join(folder, name)
    return statSync(path).isDirectory() ? files(path) : [path]
  })
}
const all = files(root).filter(path => /\.(exe|dmg|AppImage|deb|tar\.gz|sig)$/.test(path))
if (!all.length) throw new Error('No Tauri packages were produced')
function artifactName(path) {
  const suffix = path.match(/(\.app\.tar\.gz|\.tar\.gz|\.exe|\.dmg|\.AppImage|\.deb)(\.sig)?$/)?.[0]
  if (!suffix) throw new Error('Unsupported package extension')
  return `keystill-${version}-${platform}${suffix}`
}
for (const path of all) cpSync(path, join(output, artifactName(path)))
const signature = all.find(path => path.endsWith('.sig') && (platform.startsWith('windows-') ? path.endsWith('.exe.sig') : platform.startsWith('darwin-') ? path.endsWith('.app.tar.gz.sig') : path.endsWith('.AppImage.sig')))
if (process.env.TAURI_SIGNING_PRIVATE_KEY && !signature) throw new Error('Signed updater artifact is missing')
if (signature) {
  const artifact = signature.slice(0, -4)
  if (!existsSync(artifact)) throw new Error('Updater signature has no matching artifact')
  const fragment = { [platform]: { signature: readFileSync(signature, 'utf8').trim(), url: `https://github.com/Darkerhao/jiazi-vault/releases/download/v${version}/${artifactName(artifact)}` } }
  writeFileSync(join(output, `updater-${platform}.json`), JSON.stringify(fragment, null, 2) + '\n')
}
const checksums = all.map(path => `${createHash('sha256').update(readFileSync(path)).digest('hex')}  ${artifactName(path)}`).join('\n')
writeFileSync(join(output, `checksums-${platform}.txt`), checksums + '\n')
