import { computed, ref } from 'vue'
import { defineStore } from 'pinia'

export type ThemeMode = 'system' | 'light' | 'dark'
export type ClipboardTimeout = 'never' | 5 | 10 | 15 | 30 | 60

export const useSettingsStore = defineStore('settings', () => {
  const themeMode = ref<ThemeMode>('system')
  const clipboardClearTimeout = ref<ClipboardTimeout>(15)
  const autoLockMinutes = ref<number | null>(15)
  const prefersDark = ref(typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  const isDark = computed(() => themeMode.value === 'dark' || (themeMode.value === 'system' && prefersDark.value))

  if (typeof window !== 'undefined') {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (event) => {
      prefersDark.value = event.matches
    })
  }

  return { themeMode, clipboardClearTimeout, autoLockMinutes, isDark }
})
