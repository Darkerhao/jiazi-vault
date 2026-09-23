// Shared, dependency-free DotEnv rules for import preview and main-process validation.
export const ENV_NAME = /^[a-zA-Z_][a-zA-Z0-9_]*$/
export const ENV_MAX_BYTES = 1024 * 1024

export interface EnvEntry { name: string; value: string; line: number }
export interface EnvIssue { line: number; message: string }
export interface EnvPreview { entries: EnvEntry[]; issues: EnvIssue[] }

export function parseEnv(contents: string): EnvPreview {
  const lines = contents.replace(/^\uFEFF/, '').replace(/\r/g, '').split('\n')
  const entries: EnvEntry[] = [], issues: EnvIssue[] = []
  const names = new Map<string, number>()
  for (let index = 0; index < lines.length; index++) {
    const line = index + 1, text = lines[index].trimStart()
    if (!text || text.startsWith('#')) continue
    const assignment = /^(?:export[ \t]+)?([a-zA-Z_][a-zA-Z0-9_]*)[ \t]*=[ \t]*(.*)$/.exec(text)
    if (!assignment) { issues.push({ line, message: '应为 NAME=value，名称只能包含字母、数字和下划线，且不能以数字开头。' }); continue }
    const name = assignment[1]
    let value = assignment[2]
    const quote = value[0]
    if (quote === "'" || quote === '"') {
      value = value.slice(1)
      while (!value.includes(quote) && index + 1 < lines.length) value += '\n' + lines[++index]
      const end = value.indexOf(quote)
      if (end < 0) { issues.push({ line, message: '引号未闭合。' }); continue }
      const tail = value.slice(end + 1).trim()
      if (tail && !tail.startsWith('#')) { issues.push({ line, message: '闭合引号后只能有空白或注释，不支持引号转义。' }); continue }
      value = value.slice(0, end)
      if (quote === '"') value = value.replace(/\\n/g, '\n')
    } else {
      if (quote === '`') { issues.push({ line, message: '请使用单引号或双引号，反引号不属于本模块采用的 DotEnv 语法。' }); continue }
      value = value.split('#', 1)[0].trim()
    }
    if (value.includes('\0')) { issues.push({ line, message: '变量值不能包含 NUL 字符。' }); continue }
    const firstLine = names.get(name)
    if (firstLine !== undefined) issues.push({ line, message: `变量 ${name} 重复，首次出现在第 ${firstLine} 行。` })
    else names.set(name, line)
    entries.push({ name, value, line })
  }
  return { entries, issues }
}

export function validateEnvFields(fields: unknown): asserts fields is Record<string, string> {
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)
    || !Object.keys(fields).length
    || Object.entries(fields).some(([name, value]) => !ENV_NAME.test(name) || typeof value !== 'string')) throw new Error('INVALID_ENV_FIELDS')
}

export function serializeEnv(fields: Record<string, string>): string {
  validateEnvFields(fields)
  return Object.entries(fields).map(([name, value]) => {
    // Node has no general quote escaping. Select a lossless representation only.
    let encoded: string | undefined
    if (!/[\r\0]/.test(value)) {
      if (value === value.trim() && !/[\n#]/.test(value) && !/^["'`]/.test(value)) encoded = value
      else if (!value.includes("'")) encoded = `'${value}'`
      else if (!value.includes('"') && !value.includes('\\n')) encoded = `"${value}"`
    }
    if (encoded === undefined) throw new Error(`变量 ${name} 无法按 Node.js DotEnv 规则无损导出。请调整引号、换行或控制字符；加密保存不受影响。`)
    return `${name}=${encoded}`
  }).join('\n') + '\n'
}
