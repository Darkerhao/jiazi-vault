import { computed, ref, shallowRef } from 'vue'
import { defineStore } from 'pinia'
import { vaultService } from '../services/vault'
import { projectService } from '../services/project'
import { createSearchIndex, searchItems } from '../utils/search'
import { vaultErrorMessage } from '../utils/vault-error'
import type { Project, VaultItem, VaultItemSummary } from '../types/vault'

export type VaultFilter = 'all' | 'categories' | 'favorites' | 'recent' | 'trash'

export const useVaultStore = defineStore('vault', () => {
  const items = shallowRef<VaultItemSummary[]>([])
  const trashed = shallowRef<VaultItemSummary[]>([])
  const projects = shallowRef<Project[]>([])
  const error = ref('')
  const filter = ref<VaultFilter>('all')
  const loading = ref(false)
  let revision = 0
  let loaded = false, trashLoaded = false
  let pending: Promise<void> | null = null
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
    filter.value = 'all'
    loading.value = false
    loaded = trashLoaded = false
    pending = null
  }

  const filteredItems = computed(() => {
    let list = items.value
    if (filter.value === 'favorites') list = list.filter((item) => item.favorite)
    else if (filter.value === 'recent') list = list.filter((item) => item.lastAccessedAt !== undefined).sort((a, b) => b.lastAccessedAt! - a.lastAccessedAt!)
    else if (filter.value === 'trash') list = trashed.value

    return list
  })

  async function load(force = false): Promise<void> {
    const requestRevision = revision
    if (pending) {
      await pending
      if (requestRevision !== revision) return
      if (force) await load(true)
      else if (!error.value && filter.value === 'trash' && !trashLoaded) await load()
      return
    }
    if (force) trashLoaded = false
    const activeNeeded = force || !loaded
    const trashNeeded = filter.value === 'trash' && (force || !trashLoaded)
    if (!activeNeeded && !trashNeeded) return
    loading.value = true
    error.value = ''
    const task = (async () => {
      try {
        const [active, groups, deleted] = await Promise.all([
          activeNeeded ? vaultService.listItems(false) : null,
          activeNeeded ? projectService.list() : null,
          trashNeeded ? vaultService.listItems(true) : null,
        ])
        if (requestRevision !== revision) return
        if (active && groups) { items.value = active; projects.value = groups; loaded = true }
        if (deleted) { trashed.value = deleted; trashLoaded = true }
      } catch (cause) {
        if (requestRevision === revision) error.value = vaultErrorMessage(cause, '加载失败，请重试。')
      } finally {
        if (requestRevision === revision) { loading.value = false; pending = null }
      }
    })()
    pending = task
    await task
  }

  function applySummary(updated: VaultItemSummary) {
    const previous = items.value.find(item => item.id === updated.id)
    items.value = [...items.value.filter(item => item.id !== updated.id), updated]
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt)
    projects.value = projects.value.map(project => ({ ...project,
      itemCount: project.itemCount + Number(updated.projectId === project.id) - Number(previous?.projectId === project.id),
    }))
  }

  function applyUsage(id: string, lastAccessedAt: number) {
    items.value = items.value.map((item) => item.id === id ? { ...item, lastAccessedAt } : item)
  }

  async function get(id: string, recordAccess = true): Promise<VaultItem | null> {
    const requestRevision = revision
    const item = await vaultService.getItem(id, recordAccess)
    if (requestRevision !== revision) return null
    if (!item) throw new Error('ITEM_NOT_FOUND')
    if (item.lastAccessedAt !== undefined) applyUsage(id, item.lastAccessedAt)
    return item
  }

  async function createItem(input: Omit<VaultItem, 'id' | 'createdAt' | 'updatedAt'>) {
    const requestRevision = revision
    await pending
    if (requestRevision !== revision) return
    const updated = await vaultService.createItem(input)
    if (requestRevision === revision) applySummary(updated)
  }

  async function updateItem(item: VaultItem) {
    const requestRevision = revision
    await pending
    if (requestRevision !== revision) return
    const updated = await vaultService.updateItem(item)
    if (requestRevision === revision) applySummary(updated)
  }

  async function removeItem(id: string, permanently = false) {
    const requestRevision = revision
    await vaultService.deleteItem(id, permanently)
    if (requestRevision !== revision) return
    trashLoaded = false
    await load(true)
  }

  async function restoreItem(id: string) {
    const requestRevision = revision
    await vaultService.restoreItem(id)
    if (requestRevision !== revision) return
    trashLoaded = false
    await load(true)
  }

  async function toggleFavorite(id: string) {
    const requestRevision = revision
    const updated = await vaultService.toggleFavorite(id)
    if (requestRevision !== revision) return
    if (!updated) throw new Error('ITEM_NOT_FOUND')
    applySummary(updated)
  }

  async function togglePin(id: string) {
    const requestRevision = revision
    const updated = await vaultService.togglePin(id)
    if (requestRevision !== revision) return
    if (!updated) throw new Error('ITEM_NOT_FOUND')
    applySummary(updated)
  }

  return { items, trashed, projects, error, filter, loading, filteredItems, search, clear, load, get, applyUsage, createItem, updateItem, removeItem, restoreItem, toggleFavorite, togglePin }
})
