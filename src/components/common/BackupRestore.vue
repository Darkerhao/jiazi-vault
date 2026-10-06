<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import { NAlert, NButton, NForm, NFormItem, NInput, NModal, NSelect, NSpace } from 'naive-ui'
import { backupService } from '../../services/backup'
import { useAuthStore } from '../../stores/auth'
import { useSettingsStore } from '../../stores/settings'
import { callCommand } from '../../services/ipc'
import type { RecoverySnapshot } from '../../../electron/contracts'

const auth = useAuthStore()
const settings = useSettingsStore()
const show = ref(false)
const password = ref('')
const busy = ref(false)
const error = ref<string | null>(null)
const snapshots = ref<RecoverySnapshot[]>([])
const source = ref<string>('file')
const snapshotError = ref('')
let disposed = false
async function open() {
  source.value = 'file'
  snapshots.value = []
  snapshotError.value = ''
  show.value = true
  try {
    const result = await callCommand('list_recovery_snapshots')
    if (!disposed && show.value) snapshots.value = result
  } catch { if (!disposed) snapshotError.value = '本机快照列表读取失败，可重新打开此窗口重试，或从加密备份文件恢复。' }
}

function close() {
  show.value = false
  password.value = ''
  error.value = null
}

async function restore() {
  if (busy.value) return
  if (password.value.length < 8) {
    error.value = '请输入备份创建时的主密码，至少 8 个字符。'
    return
  }
  busy.value = true
  error.value = null
  try {
    const restored = await backupService.restore(password.value, source.value === 'file' ? undefined : source.value)
    if (restored) {
      auth.notice = '备份已恢复，请使用备份的主密码解锁。'
      await Promise.all([auth.checkStatus(), settings.load()])
    }
    close()
  } catch (cause) {
    error.value = cause instanceof Error && cause.message.includes('RECOVERY_SNAPSHOT_FAILED')
      ? '无法保存恢复前快照，已停止覆盖。请检查本机数据目录权限和磁盘空间。'
      : cause instanceof Error && cause.message.includes('BACKUP_TOO_LARGE')
      ? '备份超过 256 MiB 容量上限，当前保险库未被替换。'
      : '恢复失败：请检查备份主密码、文件完整性和文件权限。'
  } finally {
    password.value = ''
    busy.value = false
  }
}

onBeforeUnmount(() => { disposed = true; password.value = '' })
</script>

<template>
  <n-button :disabled="auth.busy" @click="open">从加密备份恢复</n-button>
  <n-modal :show="show" preset="card" title="恢复加密备份" style="width: 520px; max-width: calc(100vw - 40px)" :content-style="{ maxHeight: 'calc(100dvh - 180px)', overflowY: 'auto' }" :closable="!busy" :mask-closable="!busy" :close-on-esc="!busy" @update:show="(value) => !value && close()">
    <n-alert type="warning" :show-icon="false" style="margin-bottom: 20px">{{ auth.databaseError ? '恢复后使用备份创建时的主密码解锁。原数据库文件将保留在数据目录的 recovery 文件夹中。' : '恢复将整体替换当前凭证、项目、历史版本、回收站和设置；覆盖前自动保留本机快照，保存失败则停止恢复。' }}</n-alert>
    <n-alert v-if="snapshotError" type="error">{{ snapshotError }}</n-alert>
    <n-form @submit.prevent="restore">
      <n-form-item label="恢复来源">
        <n-select v-model:value="source" :disabled="busy" :options="[{ label: '加密备份文件（.jvault）', value: 'file' }, ...snapshots.map((snapshot) => ({ label: `恢复前快照 · ${new Date(snapshot.createdAt).toLocaleString()}`, value: snapshot.id }))]" aria-label="恢复来源" @update:value="password = ''; error = null" />
      </n-form-item>
      <n-alert v-if="source !== 'file'" type="info" style="margin-bottom: 16px">请输入该快照创建时的原主密码。快照保留在本机数据目录的 recovery 文件夹，密码等内容保持加密，名称和账号等元数据与原数据库一样以明文保存；它不能代替异地备份。</n-alert>
      <n-form-item label="备份主密码">
        <n-input v-model:value="password" type="password" placeholder="备份创建时使用的主密码" :disabled="busy" autofocus />
      </n-form-item>
      <n-alert v-if="error" type="error" :show-icon="false" style="margin-bottom: 16px">{{ error }}</n-alert>
      <n-space justify="end">
        <n-button :disabled="busy" @click="close">取消</n-button>
        <n-button type="primary" attr-type="submit" :loading="busy">{{ source === 'file' ? '选择文件并恢复' : '恢复所选快照' }}</n-button>
      </n-space>
    </n-form>
  </n-modal>
</template>
