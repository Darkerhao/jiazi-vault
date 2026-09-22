import type { Project, VaultItemSummary } from '../types/vault'
import { ENVIRONMENT_OPTIONS, ITEM_TYPE_LABELS } from './item-fields'

export function matchesItem(item: VaultItemSummary, query: string, projects: Project[]) {
  const text = [item.title, item.username, item.url, item.host, item.environment, item.type, item.tags?.join(' '),
    projects.find((p) => p.id === item.projectId)?.name, ITEM_TYPE_LABELS[item.type],
    ENVIRONMENT_OPTIONS.find((option) => option.value === item.environment)?.label,
  ].filter(Boolean).join(' ').toLowerCase()
  return query.trim().toLowerCase().split(/\s+/).every((term) => text.includes(term))
}
