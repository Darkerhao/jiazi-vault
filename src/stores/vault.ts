import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { vaultService } from '../services/vault'
import type { VaultItemSummary } from '../types/vault'

export const useVaultStore = defineStore('vault', () => {
  const items = ref<VaultItemSummary[]>([])
  const query = ref('')
  const loading = ref(false)
  const selectedId = ref<string | null>(null)
  const filteredItems = computed(() => {
    const normalized = query.value.trim().toLowerCase()
    if (!normalized) return items.value
    return items.value.filter((item) => [item.title, item.username, item.url, item.host, item.environment, item.type].some((value) => value?.toLowerCase().includes(normalized)))
  })

  async function load() {
    loading.value = true
    try {
      items.value = await vaultService.listItems()
    } catch {
      // The browser preview has no Tauri runtime; keep the empty state usable.
      items.value = []
    } finally {
      loading.value = false
    }
  }

  return { items, query, loading, selectedId, filteredItems, load }
})
