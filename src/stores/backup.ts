import { ref } from 'vue'
import { defineStore } from 'pinia'
import { callCommand } from '../services/ipc'
import { useAuthStore } from './auth'
import type { BackupStatus } from '../types/desktop'
import type { AutomaticBackupStatus } from '../types/contracts'

export const useBackupStore = defineStore('backup', () => {
  const status = ref<BackupStatus | null>(null)
  const automatic = ref<AutomaticBackupStatus | null>(null)
  const busy = ref(false)
  const error = ref('')
  let pending: Promise<void> | null = null
  function load(): Promise<void> {
    if (pending) return pending
    const task = read()
    pending = task
    void task.finally(() => { if (pending === task) pending = null })
    return task
  }
  async function read() {
    const auth = useAuthStore(), revision = auth.sessionRevision
    if (!auth.unlocked) return
    try {
      const [result, auto] = await Promise.all([callCommand('get_backup_status'), callCommand('get_automatic_backup_status')])
      if (revision === auth.sessionRevision) { status.value = result; automatic.value = auto; error.value = '' }
    } catch {
      if (revision === auth.sessionRevision) { status.value = null; error.value = '无法读取备份状态，请重试。' }
    }
  }
  function clear() { status.value = null; automatic.value = null; pending = null; error.value = '' }
  return { status, automatic, busy, error, load, clear }
})
