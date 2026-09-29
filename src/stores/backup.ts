import { ref } from 'vue'
import { defineStore } from 'pinia'
import { callCommand } from '../services/ipc'
import { useAuthStore } from './auth'
import type { BackupStatus } from '../../electron/backup-status'

export const useBackupStore = defineStore('backup', () => {
  const status = ref<BackupStatus | null>(null)
  const busy = ref(false)
  const error = ref('')
  async function load() {
    const auth = useAuthStore(), revision = auth.sessionRevision
    if (!auth.unlocked) return
    try {
      const result = await callCommand('get_backup_status')
      if (revision === auth.sessionRevision) { status.value = result; error.value = '' }
    } catch {
      if (revision === auth.sessionRevision) { status.value = null; error.value = '无法读取备份状态，请重试。' }
    }
  }
  function clear() { status.value = null; error.value = '' }
  return { status, busy, error, load, clear }
})
