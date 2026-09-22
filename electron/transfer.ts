import type { DatabaseSync } from 'node:sqlite'
import { createItemStore, validateItemInput, type ItemInput } from './item-store.js'
import { createProjectStore, validateProject } from './project-store.js'

import type { TransferFormat } from './contracts.js'
export type { TransferFormat } from './contracts.js'
type TransferItem = Omit<ItemInput, 'projectId'> & {
  project?: string
  createdAt?: number
  updatedAt?: number
  lastAccessedAt?: number
}

const COLUMNS = ['type', 'title', 'project', 'environment', 'username', 'password', 'url', 'host', 'port', 'notes', 'tags', 'fields', 'favorite', 'createdAt', 'updatedAt', 'lastAccessedAt'] as const
const TIME_COLUMNS = ['createdAt', 'updatedAt', 'lastAccessedAt'] as const
const CSV_ESCAPE = /^[=+\-@\t\r\n']/

export function assertTransferFormat(value: unknown): asserts value is TransferFormat {
  if (value !== 'json' && value !== 'csv') throw new Error('INVALID_TRANSFER_FORMAT')
}

function csvCell(value: unknown): string {
  let text = value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value)
  // A reversible apostrophe escape prevents spreadsheet formula evaluation.
  if (CSV_ESCAPE.test(text)) text = `'${text}`
  return `"${text.replace(/"/g, '""')}"`
}

function parseCsv(contents: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  let closed = false
  function endCell() {
    row.push(cell.startsWith("'") && CSV_ESCAPE.test(cell.slice(1)) ? cell.slice(1) : cell)
    cell = ''
    closed = false
  }
  for (let i = 0; i < contents.length; i++) {
    const char = contents[i]
    if (quoted) {
      if (char !== '"') cell += char
      else if (contents[i + 1] === '"') { cell += '"'; i++ }
      else { quoted = false; closed = true }
    } else if (char === ',' || char === '\r' || char === '\n') {
      endCell()
      if (char !== ',') {
        rows.push(row)
        row = []
        if (char === '\r' && contents[i + 1] === '\n') i++
      }
    } else if (char === '"' && !cell && !closed) quoted = true
    else {
      if (closed || char === '"') throw new Error('INVALID_IMPORT')
      cell += char
    }
  }
  if (quoted) throw new Error('INVALID_IMPORT')
  if (cell || closed || row.length) { endCell(); rows.push(row) }
  return rows
}

function validateTransferItem(value: unknown): TransferItem {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_IMPORT')
  const row = value as TransferItem
  if (Object.keys(row).some((key) => !COLUMNS.includes(key as typeof COLUMNS[number]))) throw new Error('INVALID_IMPORT')
  const input = { ...row, favorite: row.favorite === undefined ? false : row.favorite }
  validateItemInput(input)
  if (input.project !== undefined) validateProject({ name: input.project })
  for (const column of TIME_COLUMNS) {
    if (input[column] !== undefined && (!Number.isSafeInteger(input[column]) || input[column]! < 0)) throw new Error('INVALID_IMPORT')
  }
  return input
}

export function readPlaintext(contents: string, format: TransferFormat): TransferItem[] {
  try {
    assertTransferFormat(format)
    const text = contents.replace(/^\uFEFF/, '')
    let values: unknown
    if (format === 'json') values = JSON.parse(text)
    else {
      const [headers, ...rows] = parseCsv(text)
      if (!headers || !headers.includes('type') || !headers.includes('title')
        || new Set(headers).size !== headers.length
        || headers.some((header) => !COLUMNS.includes(header as typeof COLUMNS[number]))) throw new Error('INVALID_IMPORT')
      values = rows.map((cells) => {
        if (cells.length !== headers.length) throw new Error('INVALID_IMPORT')
        return Object.fromEntries(headers.flatMap((header, i) => {
          const value = cells[i]
          if (value === '') return []
          if (['tags', 'fields', 'favorite'].includes(header)) return [[header, JSON.parse(value)]]
          if (header === 'port' || TIME_COLUMNS.includes(header as typeof TIME_COLUMNS[number])) {
            if (!/^\d+$/.test(value)) throw new Error('INVALID_IMPORT')
            return [[header, Number(value)]]
          }
          return [[header, value]]
        }))
      })
    }
    if (!Array.isArray(values)) throw new Error('INVALID_IMPORT')
    return values.map(validateTransferItem)
  } catch { throw new Error('INVALID_IMPORT') }
}

export function exportPlaintext(db: DatabaseSync, key: Buffer, format: TransferFormat): string {
  assertTransferFormat(format)
  const store = createItemStore(db, () => key)
  const projects = new Map(createProjectStore(db).list().map((project) => [project.id, project.name]))
  const values = store.list().map((summary): TransferItem => {
    const { id, projectId, deletedAt, ...item } = store.get(summary.id)!
    return { ...item, project: projectId ? projects.get(projectId) : undefined }
  })
  if (format === 'json') return JSON.stringify(values, null, 2)
  return '\uFEFF' + [COLUMNS.join(','), ...values.map((item) => COLUMNS.map((column) => csvCell(item[column])).join(','))].join('\r\n') + '\r\n'
}

/** Append all rows atomically; IDs belong to the destination vault. */
export function importPlaintext(db: DatabaseSync, key: Buffer, values: TransferItem[]): number {
  const validated = values.map(validateTransferItem)
  const items = createItemStore(db, () => key)
  const projects = createProjectStore(db)
  const findProject = db.prepare('SELECT id FROM projects WHERE name = ?')
  const timestamps = db.prepare('UPDATE items SET created_at = ?, updated_at = ?, last_accessed_at = ? WHERE id = ?')
  db.exec('BEGIN IMMEDIATE')
  try {
    for (const value of validated) {
      const { project, createdAt, updatedAt, lastAccessedAt, ...input } = value
      const name = project?.trim()
      const existing = name ? findProject.get(name) : undefined
      const projectId = name ? existing ? String(existing.id) : projects.create({ name }).id : undefined
      const item = items.create({ ...input, projectId })
      timestamps.run(createdAt ?? item.createdAt, updatedAt ?? item.updatedAt, lastAccessedAt ?? null, item.id)
    }
    db.exec('COMMIT')
    return validated.length
  } catch {
    db.exec('ROLLBACK')
    throw new Error('IMPORT_FAILED')
  }
}
