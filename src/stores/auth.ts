import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { vaultService } from '../services/vault'

export const useAuthStore = defineStore('auth', () => {
  const unlocked = ref(false)
  const hasVault = ref<boolean | null>(null)
  const busy = ref(false)
  const error = ref<string | null>(null)

  const isReady = computed(() => hasVault.value !== null)

  async function checkStatus() {
    try {
      unlocked.value = await vaultService.isUnlocked()
      hasVault.value = unlocked.value
    } catch {
      hasVault.value = false
    }
  }

  async function unlock(password: string) {
    busy.value = true
    error.value = null
    try {
      const result = await vaultService.unlock(password)
      unlocked.value = result.unlocked
      if (!result.unlocked) error.value = '无法解锁保险库，请检查主密码。'
      hasVault.value = true
      return result.unlocked
    } catch {
      error.value = '无法解锁保险库，请检查主密码。'
      return false
    } finally {
      busy.value = false
    }
  }

  async function lock() {
    await vaultService.lock()
    unlocked.value = false
  }

  return { unlocked, hasVault, busy, error, isReady, checkStatus, unlock, lock }
})
