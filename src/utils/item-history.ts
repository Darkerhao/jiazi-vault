import type { VaultItem } from '../types/vault'

const contentKeys = ['title', 'type', 'projectId', 'environment', 'username', 'password', 'url', 'host', 'port', 'notes', 'tags'] as const
export type HistoryValue = string | number | string[] | undefined
export interface HistoryFieldDiff {
  key: string
  before: HistoryValue
  after: HistoryValue
  kind: 'added' | 'removed' | 'changed' | 'unchanged'
}

/** Direction is the selected history snapshot → current saved content. */
export function diffItemHistory(previous: VaultItem, current: VaultItem): HistoryFieldDiff[] {
  const rows: HistoryFieldDiff[] = []
  function add(key: string, before: HistoryValue, after: HistoryValue) {
    if (before === undefined && after === undefined) return
    const kind = before === undefined ? 'added' : after === undefined ? 'removed'
      : JSON.stringify(before) === JSON.stringify(after) ? 'unchanged' : 'changed'
    rows.push({ key, before, after, kind })
  }
  for (const key of contentKeys) {
    add(key, key === 'tags' ? previous.tags ?? [] : previous[key], key === 'tags' ? current.tags ?? [] : current[key])
  }
  const before = previous.fields ?? {}, after = current.fields ?? {}
  for (const name of new Set([...Object.keys(before), ...Object.keys(after)])) {
    add(`field:${name}`, Object.prototype.hasOwnProperty.call(before, name) ? before[name] : undefined, Object.prototype.hasOwnProperty.call(after, name) ? after[name] : undefined)
  }
  return rows
}
