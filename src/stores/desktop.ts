import { ref } from 'vue'
import { defineStore } from 'pinia'
import type { DesktopAction } from '../../electron/desktop'

export const useDesktopStore = defineStore('desktop', () => {
  const pendingAction = ref<DesktopAction | null>(null)
  const quickSearchOpen = ref(false)
  function request(action: DesktopAction) { pendingAction.value = action }
  function clear() { pendingAction.value = null; quickSearchOpen.value = false }
  return { pendingAction, quickSearchOpen, request, clear }
})
