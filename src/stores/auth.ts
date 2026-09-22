import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { vaultService } from '../services/vault'

export const useAuthStore = defineStore('auth', () => {
  const unlocked = ref(false)
  const hasVault = ref<boolean | null>(null)
  const busy = ref(false)
  const error = ref<string | null>(null)
  const notice = ref<string | null>(null)
  const sessionRevision = ref(0)
  const retryAt = ref(0)

  function markLocked() {
    sessionRevision.value++
    unlocked.value = false
    error.value = null
  }

  const isReady = computed(() => hasVault.value !== null)

  async function checkStatus() {
    const revision = sessionRevision.value
    try {
      const status = await vaultService.status()
      if (revision !== sessionRevision.value) return
      unlocked.value = status.unlocked
      hasVault.value = status.exists
      retryAt.value = status.retryAt
    } catch {
      error.value = '无法连接桌面服务，请重新启动应用。'
    }
  }

  async function create(password: string) {
    if (busy.value) return false
    const revision = sessionRevision.value
    busy.value = true
    error.value = null
    try {
      await vaultService.create(password)
      if (revision !== sessionRevision.value) return false
      unlocked.value = true
      hasVault.value = true
      return true
    } catch (cause) {
      error.value = cause instanceof Error && cause.message.includes('VAULT_EXISTS')
        ? '保险库已经创建，请输入主密码解锁。'
        : '无法创建保险库，请稍后重试。'
      return false
    } finally {
      busy.value = false
    }
  }

  async function unlock(password: string) {
    if (busy.value) return false
    const revision = sessionRevision.value
    busy.value = true
    error.value = null
    try {
      const result = await vaultService.unlock(password)
      if (revision !== sessionRevision.value) return false
      unlocked.value = result.unlocked
      retryAt.value = result.retryAt
      if (!result.unlocked) error.value = '无法解锁保险库，请检查主密码。'
      hasVault.value = true
      return result.unlocked
    } catch (cause) {
      error.value = cause instanceof Error && cause.message.includes('VAULT_NOT_FOUND')
        ? '保险库尚未创建，请先设置主密码。'
        : '无法解锁保险库，请检查主密码。'
      return false
    } finally {
      busy.value = false
    }
  }

  async function lock() {
    await vaultService.lock()
    if (unlocked.value) markLocked()
  }

  return { unlocked, hasVault, busy, error, notice, sessionRevision, retryAt, isReady, checkStatus, create, unlock, lock, markLocked }
})
