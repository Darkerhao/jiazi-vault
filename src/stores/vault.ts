import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { vaultService } from '../services/vault'
import type { VaultItem, VaultItemSummary } from '../types/vault'

export type VaultFilter = 'all' | 'favorites' | 'recent' | 'trash'

export const useVaultStore = defineStore('vault', () => {
  const items = ref<VaultItemSummary[]>([])
  const trashed = ref<VaultItemSummary[]>([])
  const query = ref('')
  const filter = ref<VaultFilter>('all')
  const loading = ref(false)

  const filteredItems = computed(() => {
    let list = items.value
    if (filter.value === 'favorites') list = list.filter((item) => item.favorite)
    else if (filter.value === 'recent') list = [...list].sort((a, b) => b.updatedAt - a.updatedAt)
    else if (filter.value === 'trash') list = trashed.value

    const normalized = query.value.trim().toLowerCase()
    if (!normalized) return list
    return list.filter((item) => [item.title, item.username, item.url, item.host, item.environment, item.type, item.tags?.join(' ')].some((value) => value?.toLowerCase().includes(normalized)))
  })

  async function load() {
    loading.value = true
    try {
      items.value = await vaultService.listItems(false)
      trashed.value = await vaultService.listItems(true)
    } catch {
      items.value = []
      trashed.value = []
    } finally {
      loading.value = false
    }
  }

  async function get(id: string): Promise<VaultItem | null> {
    try {
      return await vaultService.getItem(id)
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
    try {
      const updated = await vaultService.toggleFavorite(id)
      const index = items.value.findIndex((item) => item.id === id)
      if (index !== -1) items.value[index] = updated
      return true
    } catch {
      return false
    }
  }

  return { items, trashed, query, filter, loading, filteredItems, load, get, createItem, updateItem, removeItem, restoreItem, toggleFavorite }
})
