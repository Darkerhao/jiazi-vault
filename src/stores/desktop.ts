import { ref } from 'vue'
import { defineStore } from 'pinia'
import type { DesktopAction } from '../types/desktop'

export const useDesktopStore = defineStore('desktop', () => {
  const pendingAction = ref<DesktopAction | null>(null)
  const quickSearchOpen = ref(false)
  const quickSearchTransient = ref(false)
  function request(action: DesktopAction) {
    if (action === 'quick-search' || action === 'quick-search-global') {
      quickSearchTransient.value = action === 'quick-search-global'
    }
    pendingAction.value = action
  }
  function clear() {
    pendingAction.value = null
    quickSearchOpen.value = false
    quickSearchTransient.value = false
  }
  return { pendingAction, quickSearchOpen, quickSearchTransient, request, clear }
})
