import { computed, ref, shallowRef } from 'vue'
import { defineStore } from 'pinia'
import { vaultService } from '../services/vault'
import { projectService } from '../services/project'
import { createSearchIndex, searchItems } from '../utils/search'
import type { Project, VaultItem, VaultItemSummary } from '../types/vault'

export type VaultFilter = 'all' | 'categories' | 'favorites' | 'recent' | 'trash'

export const useVaultStore = defineStore('vault', () => {
  const items = shallowRef<VaultItemSummary[]>([])
  const trashed = shallowRef<VaultItemSummary[]>([])
  const projects = shallowRef<Project[]>([])
  const error = ref('')
  const query = ref('')
  const filter = ref<VaultFilter>('all')
  const loading = ref(false)
  let revision = 0
  const searchIndex = computed(() => createSearchIndex([...items.value, ...trashed.value], projects.value))

  function search(list: VaultItemSummary[], text: string, limit = Infinity) {
    if (!text.trim()) return list.slice(0, limit)
    return searchItems(list, text, searchIndex.value, limit)
  }

  function clear() {
    revision++
    items.value = []
    trashed.value = []
    projects.value = []
    error.value = ''
    query.value = ''
    filter.value = 'all'
    loading.value = false
  }

  const filteredItems = computed(() => {
    let list = items.value
    if (filter.value === 'favorites') list = list.filter((item) => item.favorite)
    else if (filter.value === 'recent') list = list.filter((item) => item.lastAccessedAt !== undefined).sort((a, b) => b.lastAccessedAt! - a.lastAccessedAt!)
    else if (filter.value === 'trash') list = trashed.value

    return search(list, query.value)
  })

  async function load() {
    const requestRevision = revision
    loading.value = true
    error.value = ''
    try {
      const [active, deleted, groups] = await Promise.all([vaultService.listItems(false), vaultService.listItems(true), projectService.list()])
      if (requestRevision !== revision) return
      items.value = active
      trashed.value = deleted
      projects.value = groups
    } catch {
      if (requestRevision === revision) {
        items.value = []
        trashed.value = []
        projects.value = []
        error.value = '加载失败，请重试。'
      }
    } finally {
      if (requestRevision === revision) loading.value = false
    }
  }

  function applyUsage(id: string, lastAccessedAt: number) {
    items.value = items.value.map((item) => item.id === id ? { ...item, lastAccessedAt } : item)
  }

  async function get(id: string, recordAccess = true): Promise<VaultItem | null> {
    const requestRevision = revision
    try {
      const item = await vaultService.getItem(id, recordAccess)
      if (requestRevision !== revision) return null
      if (item?.lastAccessedAt !== undefined) applyUsage(id, item.lastAccessedAt)
      return item
    } catch {
      return null
    }
  }

  async function createItem(input: Omit<VaultItem, 'id' | 'createdAt' | 'updatedAt'>) {
    try {
      await vaultService.createItem(input)
      await load()
      return true
    } catch {
      return false
    }
  }

  async function updateItem(item: VaultItem) {
    try {
      await vaultService.updateItem(item)
      await load()
      return true
    } catch {
      return false
    }
  }

  async function removeItem(id: string, permanently = false) {
    try {
      await vaultService.deleteItem(id, permanently)
      await load()
      return true
    } catch {
      return false
    }
  }

  async function restoreItem(id: string) {
    try {
      await vaultService.restoreItem(id)
      await load()
      return true
    } catch {
      return false
    }
  }

  async function toggleFavorite(id: string) {
    const requestRevision = revision
    try {
      const updated = await vaultService.toggleFavorite(id)
      if (requestRevision !== revision) return false
      items.value = items.value.map((item) => item.id === id ? updated : item)
      return true
    } catch {
      return false
    }
  }

  return { items, trashed, projects, error, query, filter, loading, filteredItems, search, clear, load, get, applyUsage, createItem, updateItem, removeItem, restoreItem, toggleFavorite }
})
