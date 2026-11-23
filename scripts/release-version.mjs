import { readFileSync, writeFileSync } from 'node:fs'

export function writeVersion(version) {
  const replace = (file, pattern) => {
    const source = readFileSync(file, 'utf8')
    if (!pattern.test(source)) throw new Error(`Cannot find the version field in ${file}`)
    writeFileSync(file, source.replace(pattern, (_, prefix, suffix) => `${prefix}${version}${suffix}`))
  }

  replace('package.json', /("version"\s*:\s*")[^"]+(")/)
  replace('src-tauri/Cargo.toml', /^(version\s*=\s*")[^"]+(")/m)
  replace('src-tauri/Cargo.lock', /(\[\[package\]\]\r?\nname = "keystill"\r?\nversion = ")[^"]+(")/)
}
