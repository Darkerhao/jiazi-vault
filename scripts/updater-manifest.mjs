import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const [directory, tag, notesFile] = process.argv.slice(2)
if (!/^v\d+\.\d+\.\d+$/.test(tag ?? '') || !directory || !notesFile) throw new Error('Expected <release directory> <version tag> <notes file>')
const fragments = readdirSync(directory).filter(name => /^updater-(windows|darwin|linux)-/.test(name) && name.endsWith('.json'))
// Unsigned builds retain manual updates and must never advertise an automatic install.
if (fragments.length) {
  const platforms = Object.assign({}, ...fragments.map(name => JSON.parse(readFileSync(join(directory, name), 'utf8'))))
  if (Object.keys(platforms).length !== 4) throw new Error('A signed release must include all four platform/architecture updater artifacts')
  writeFileSync(join(directory, 'tauri-updater.json'), JSON.stringify({ version: tag.slice(1), notes: readFileSync(notesFile, 'utf8'), pub_date: new Date().toISOString(), platforms }, null, 2) + '\n')
}
