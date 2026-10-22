import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { callCommand } from '../services/ipc'
import type { UpdateState } from '../../electron/app-update'

export const useUpdatesStore = defineStore('updates', () => {
  const state = ref<UpdateState | null>(null)
  const error = ref('')
  const hasUpdate = computed(() => state.value?.update?.newer === true)
  const busy = computed(() => !!state.value && ['checking', 'downloading', 'confirming', 'installing'].includes(state.value.status))

  async function load() {
    error.value = ''
    try {
      const current = await callCommand('get_update_state')
      state.value ??= current
    } catch { error.value = '无法读取更新状态，请重试。' }
  }
  async function run(command: 'check_for_updates' | 'install_update') {
    error.value = ''
    try { await callCommand(command) }
    catch (cause) {
      error.value = String(cause).includes('VAULT_BUSY')
        ? '保险库操作尚未完成，请完成后重试更新。'
        : '更新操作失败，请稍后重试。'
    }
  }
  return { state, error, hasUpdate, busy, load, run }
})
