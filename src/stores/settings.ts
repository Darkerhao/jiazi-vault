import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { useBackupStore } from './backup'
import { useAuthStore } from './auth'
import type { AppSettings } from '../types/desktop'
import { settingsService } from '../services/settings'

export const useSettingsStore = defineStore('settings', () => {
  const preferences = ref<AppSettings | null>(null)
  const busy = ref(false)
  const error = ref<string | null>(null)
  const saved = ref(false)
  let pending = Promise.resolve()
  const prefersDark = ref(typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  const isDark = computed(() => preferences.value?.themeMode === 'dark' || ((preferences.value?.themeMode ?? 'system') === 'system' && prefersDark.value))

  async function load() {
    error.value = null
    try { preferences.value = await settingsService.get() }
    catch { error.value = '读取设置失败，请重试。' }
  }

  function update(patch: Partial<AppSettings>) {
    const auth = useAuthStore(), revision = auth.sessionRevision
    pending = pending.then(() => revision === auth.sessionRevision ? save(patch) : undefined)
    return pending
  }
  async function save(patch: Partial<AppSettings>) {
    if (!preferences.value) return
    busy.value = true
    error.value = null
    saved.value = false
    const auth = useAuthStore(), revision = auth.sessionRevision
    try {
      const result = await settingsService.save({ ...preferences.value, ...patch })
      if (revision !== auth.sessionRevision) return
      preferences.value = result; saved.value = true; void useBackupStore().load()
    }
    catch { error.value = '设置保存失败，已保留原设置。请重试。' }
    finally { busy.value = false }
  }

  if (typeof window !== 'undefined') {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (event) => {
      prefersDark.value = event.matches
    })
  }

  return { preferences, busy, error, saved, isDark, load, update }
})
