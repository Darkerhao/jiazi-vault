import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

const [tag, output] = process.argv.slice(2)
const stableTag = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: 'pipe', windowsHide: true }).trim()

if (!tag || !stableTag.test(tag) || !output) throw new Error('Usage: release-notes.mjs v<major.minor.patch> <output>')
if (git('rev-parse', '--is-shallow-repository') === 'true') throw new Error('Release notes require the complete Git history')

const tags = git('tag', '--merged', tag, '--sort=-version:refname').split('\n').filter(value => stableTag.test(value))
const index = tags.indexOf(tag)
if (index === -1) throw new Error(`Release tag ${tag} does not exist`)
const previous = tags[index + 1]
// Include all commits, including merged branches and release/version commits.
const commits = git('log', '--reverse', '--topo-order', '--abbrev=7', '-z', '--format=%h%x00%B', previous ? `${previous}..${tag}` : tag).split('\0')
const entries = []
for (let i = 0; i + 1 < commits.length; i += 2) {
  const [subject, ...body] = commits[i + 1].trim().split('\n')
  const details = body.join('\n').trim()
  entries.push(`- ${subject} (${commits[i]})${details ? `\n\n${details.split('\n').map(line => `  ${line}`).join('\n')}` : ''}`)
}
const heading = previous ? `${previous} → ${tag}` : `${tag}（首次发布）`
mkdirSync(dirname(output), { recursive: true })
writeFileSync(output, `${heading}\n\n更新内容（${entries.length} 条提交）：\n\n${entries.join('\n\n')}\n`)
