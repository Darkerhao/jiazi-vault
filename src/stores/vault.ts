import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { vaultService } from '../services/vault'
import { projectService } from '../services/project'
import { matchesItem } from '../utils/search'
import type { Project, VaultItem, VaultItemSummary } from '../types/vault'

export type VaultFilter = 'all' | 'favorites' | 'recent' | 'trash'

export const useVaultStore = defineStore('vault', () => {
  const items = ref<VaultItemSummary[]>([])
  const trashed = ref<VaultItemSummary[]>([])
  const projects = ref<Project[]>([])
  const error = ref('')
  const query = ref('')
  const filter = ref<VaultFilter>('all')
  const loading = ref(false)
  let revision = 0

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
    else if (filter.value === 'recent') list = [...list].sort((a, b) => b.updatedAt - a.updatedAt)
    else if (filter.value === 'trash') list = trashed.value

    const normalized = query.value.trim().toLowerCase()
    if (!normalized) return list
    return list.filter((item) => matchesItem(item, normalized, projects.value))
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

  async function get(id: string): Promise<VaultItem | null> {
    const requestRevision = revision
    try {
      const item = await vaultService.getItem(id)
      return requestRevision === revision ? item : null
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
      const index = items.value.findIndex((item) => item.id === id)
      if (index !== -1) items.value[index] = updated
      return true
    } catch {
      return false
    }
  }

  return { items, trashed, projects, error, query, filter, loading, filteredItems, clear, load, get, createItem, updateItem, removeItem, restoreItem, toggleFavorite }
})
