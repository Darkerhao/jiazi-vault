import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type { AppSettings } from '../../electron/settings'
import { settingsService } from '../services/settings'

export const useSettingsStore = defineStore('settings', () => {
  const preferences = ref<AppSettings | null>(null)
  const busy = ref(false)
  const error = ref<string | null>(null)
  const prefersDark = ref(typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  const isDark = computed(() => preferences.value?.themeMode === 'dark' || ((preferences.value?.themeMode ?? 'system') === 'system' && prefersDark.value))

  async function load() {
    error.value = null
    try { preferences.value = await settingsService.get() }
    catch { error.value = '读取设置失败，请重试。' }
  }

  async function update(patch: Partial<AppSettings>) {
    if (!preferences.value || busy.value) return
    busy.value = true
    error.value = null
    try { preferences.value = await settingsService.save({ ...preferences.value, ...patch }) }
    catch { error.value = '设置保存失败，已保留原设置。请重试。' }
    finally { busy.value = false }
  }

  if (typeof window !== 'undefined') {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (event) => {
      prefersDark.value = event.matches
    })
  }

  return { preferences, busy, error, isDark, load, update }
})
