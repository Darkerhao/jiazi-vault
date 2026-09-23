import type { Project, VaultItemSummary } from '../types/vault'
import { ENVIRONMENT_OPTIONS, ITEM_TYPE_LABELS } from './item-fields'

export function createSearchIndex(items: VaultItemSummary[], projects: Project[]) {
  const projectNames = new Map(projects.map((project) => [project.id, project.name]))
  return new Map(items.map((item) => [item.id, [
    item.title, item.username, item.url, item.host, item.environment, item.type, item.tags?.join(' '),
    item.projectId ? projectNames.get(item.projectId) : undefined, ITEM_TYPE_LABELS[item.type],
    ENVIRONMENT_OPTIONS.find((option) => option.value === item.environment)?.label,
  ].filter(Boolean).join(' ').toLowerCase()]))
}

export function searchItems(items: VaultItemSummary[], query: string, index: Map<string, string>, limit = Infinity) {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const results: VaultItemSummary[] = []
  for (const item of items) {
    if (terms.every((term) => index.get(item.id)?.includes(term))) results.push(item)
    if (results.length >= limit) break
  }
  return results
}
