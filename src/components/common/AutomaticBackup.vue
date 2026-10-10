<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { NAlert, NButton, NSpace, NText } from 'naive-ui'
import { callCommand } from '../../services/ipc'
import { useAuthStore } from '../../stores/auth'
import type { AutomaticBackupStatus } from '../../../electron/contracts'

const auth = useAuthStore()
const status = ref<AutomaticBackupStatus | null>(null)
const busy = ref(false), error = ref('')
let disposed = false, request = 0
async function load() {
  const current = ++request, revision = auth.sessionRevision
  try {
    const result = await callCommand('get_automatic_backup_status')
    if (!disposed && current === request && revision === auth.sessionRevision) { status.value = result; error.value = '' }
  } catch {
    if (!disposed && current === request && revision === auth.sessionRevision) error.value = '无法读取自动备份状态，请重试。'
  }
}
async function perform(action: 'configure' | 'disable' | 'run') {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    if (action === 'run') await callCommand('run_automatic_backup')
    else await callCommand('configure_automatic_backup', { enabled: action === 'configure' })
    await load()
  } catch {
    await load()
    if (!disposed) error.value = '操作未完成，请确认保险库已解锁、没有其他备份操作，并检查目录权限或外部磁盘连接后重试。'
  } finally { busy.value = false }
}
const unsubscribe = window.jiaziVault?.onBackupChanged(load)
onMounted(load)
onBeforeUnmount(() => { disposed = true; request++; unsubscribe?.() })
</script>

<template>
  <section class="automatic-backup">
    <h3>自动加密备份</h3>
    <n-alert v-if="error" type="error">{{ error }} <n-button text :disabled="busy" @click="load">刷新状态</n-button></n-alert>
    <template v-if="status">
      <p v-if="status.directory" class="backup-directory"><n-text depth="3">备份目录：</n-text>{{ status.directory }}</p>
      <p v-else><n-text depth="3">尚未启用。选择备份位置后，会创建本应用专用的备份文件夹。</n-text></p>
      <n-alert v-if="status.error" type="warning">自动备份或文件检查未完成。请检查目标磁盘与目录权限，然后重试。</n-alert>
      <n-alert v-else-if="status.directory && status.lastBackupAt && !status.fileExists" type="warning">最近的自动备份文件已不存在，请立即重新备份。</n-alert>
      <p v-if="status.lastBackupAt">最近自动备份：{{ new Date(status.lastBackupAt).toLocaleString() }} · {{ status.fileExists ? '文件存在' : '文件缺失' }}</p>
      <n-space>
        <n-button :disabled="busy" @click="perform('configure')">{{ status.directory ? '更换备份位置' : '选择目录并启用' }}</n-button>
        <n-button v-if="status.directory" :loading="busy" @click="perform('run')">立即自动备份</n-button>
        <n-button v-if="status.directory" :disabled="busy" @click="perform('disable')">停用自动备份</n-button>
      </n-space>
    </template>
    <p><n-text depth="3">保存后自动备份，短时间内的连续修改会合并处理；解锁期间每分钟检查并重试，保留当前专用目录最近 10 份。锁定或退出后暂停。停用或更换位置会保留原目录文件。建议选择另一块磁盘，恢复备份需要备份创建时的主密码。</n-text></p>
  </section>
</template>

<style scoped>
.automatic-backup { margin-top: 24px; border-top: 1px solid var(--n-border-color); padding-top: 8px; }
.backup-directory { overflow-wrap: anywhere; }
</style>
