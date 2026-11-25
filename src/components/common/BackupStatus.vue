<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { NAlert, NButton, NSpace, NText, useMessage } from 'naive-ui'
import { useBackupStore } from '../../stores/backup'
import { useAuthStore } from '../../stores/auth'
import { backupService } from '../../services/backup'

defineProps<{ detailed?: boolean }>()
const backup = useBackupStore()
const auth = useAuthStore()
const message = useMessage()
const description = computed(() => !backup.status?.lastBackupAt ? '尚未创建加密备份，建议现在保存一份。' : backup.status.hasChanges ? '有未备份的内容修改，建议更新备份。' : '内容修改已备份。')
const automaticWarning = computed(() => {
  const auto = backup.automatic
  if (!auto?.directory) return ''
  if (!auto.directoryAvailable) return '自动备份目录不可用，请连接目标磁盘或更换备份位置。'
  if (auto.error) return '自动备份未完成，请检查目录权限并重试。'
  if (auto.lastBackupAt && !auto.fileExists) return '最近的自动备份文件已缺失，请重新备份。'
  return ''
})
onMounted(() => backup.load())
async function create() {
  if (backup.busy) return
  backup.busy = true
  const revision = auth.sessionRevision
  try {
    const name = await backupService.create()
    if (revision !== auth.sessionRevision || !name) return
    await backup.load()
    message.success(`加密备份已保存：${name}`)
  } catch (cause) {
    if (revision === auth.sessionRevision) message.error(cause instanceof Error && cause.message.includes('BACKUP_TOO_LARGE') ? '备份超过 256 MiB 容量上限，未生成备份文件。' : '备份保存失败，请检查目标位置权限后重试。')
  } finally { backup.busy = false }
}
</script>

<template>
  <n-alert v-if="backup.error" type="warning">{{ backup.error }} <n-button text @click="backup.load">重试</n-button></n-alert>
  <n-alert v-if="automaticWarning" type="warning">{{ automaticWarning }}</n-alert>
  <div v-if="!backup.error && backup.status && (detailed || backup.status.hasChanges)" class="backup-status" :class="{ compact: !detailed }" role="status">
    <div><n-text>{{ description }}</n-text><n-text v-if="backup.status?.lastBackupAt" depth="3" class="backup-date">最近备份：{{ new Date(backup.status.lastBackupAt).toLocaleString() }}</n-text></div>
    <n-button :loading="backup.busy" :text="!detailed" :type="detailed ? 'primary' : 'default'" @click="create">{{ detailed ? '创建加密备份' : '立即备份' }}</n-button>
  </div>
  <template v-if="detailed">
    <p v-if="backup.automatic?.lastBackupAt"><n-text depth="3">最近自动备份：{{ new Date(backup.automatic.lastBackupAt).toLocaleString() }} · {{ backup.automatic.fileExists ? '文件存在，尚需验证可读性' : '文件缺失' }}</n-text></p>
    <p><n-text depth="3">备份包含全部凭证、历史版本、项目、回收站和偏好设置。恢复需要备份创建时的主密码；查看和复制记录不触发内容备份提醒。</n-text></p>
    <p><n-text depth="3">建议将备份保存到另一块磁盘或外部设备。同一磁盘上的备份不能应对磁盘损坏；此处记录保存时间，不持续检查备份文件是否仍存在。</n-text></p>
    <n-space><slot /></n-space>
  </template>
</template>

<style scoped>
.backup-status { display: flex; justify-content: space-between; align-items: center; gap: 16px; padding: 12px 0; }
.backup-status > div { min-width: 0; }
.backup-status .n-button { flex-shrink: 0; }
.backup-date { display: block; margin-top: 4px; font-size: 12px; }
.backup-status.compact { padding: 0 0 12px; gap: 12px; font-size: 12px; }
.compact > div { display: flex; flex-wrap: wrap; gap: 4px 12px; }
.compact .backup-date { margin: 0; }
@container workspace (max-width: 560px) {
  .backup-status { flex-wrap: wrap; }
}
</style>
