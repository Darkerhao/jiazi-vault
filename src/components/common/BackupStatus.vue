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
  <div v-else-if="backup.status && (detailed || backup.status.hasChanges)" class="backup-status" role="status">
    <div><n-text>{{ description }}</n-text><n-text v-if="backup.status?.lastBackupAt" depth="3" class="backup-date">最近备份：{{ new Date(backup.status.lastBackupAt).toLocaleString() }}</n-text></div>
    <n-button :loading="backup.busy" :type="detailed ? 'primary' : 'default'" @click="create">创建加密备份</n-button>
  </div>
  <template v-if="detailed">
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
</style>
