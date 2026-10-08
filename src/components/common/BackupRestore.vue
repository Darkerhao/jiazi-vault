<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import { NAlert, NButton, NForm, NFormItem, NInput, NModal, NSelect, NSpace } from 'naive-ui'
import { backupService } from '../../services/backup'
import { useAuthStore } from '../../stores/auth'
import { useSettingsStore } from '../../stores/settings'
import { callCommand } from '../../services/ipc'
import type { RecoverySnapshot, BackupSource, BackupPreview } from '../../../electron/contracts'

const auth = useAuthStore(), settings = useSettingsStore()
const show = ref(false), busy = ref(false), password = ref(''), error = ref('')
const snapshots = ref<RecoverySnapshot[]>([]), source = ref('file'), snapshotError = ref('')
const chosen = ref<BackupSource | null>(null), preview = ref<BackupPreview | null>(null)
let disposed = false
function reset() {
  const token = chosen.value?.token
  chosen.value = null
  preview.value = null
  password.value = ''
  error.value = ''
  if (token) void callCommand('cancel_backup_restore', { token }).catch(() => {})
}
async function open() {
  reset()
  source.value = 'file'
  snapshots.value = []
  snapshotError.value = ''
  show.value = true
  try {
    const result = await callCommand('list_recovery_snapshots')
    if (!disposed && show.value) snapshots.value = result
  } catch { if (!disposed) snapshotError.value = '本机快照列表读取失败，可重新打开此窗口重试，或从加密备份文件恢复。' }
}
function close() { show.value = false; reset() }
function failure(cause: unknown) {
  error.value = String(cause).includes('RECOVERY_SNAPSHOT_FAILED')
    ? '无法保存恢复前快照，已停止覆盖。请检查本机数据目录权限和磁盘空间。'
    : String(cause).includes('BACKUP_TOO_LARGE') ? '备份超过 256 MiB 容量上限，当前保险库未被替换。'
    : '操作未完成，当前保险库未被替换。请检查备份主密码、文件完整性和权限，或重新选择备份。'
}
async function choose() {
  if (busy.value) return
  reset()
  busy.value = true
  try {
    const result = await callCommand('select_backup_source', { snapshotId: source.value === 'file' ? undefined : source.value })
    if (disposed) {
      if (result) void callCommand('cancel_backup_restore', { token: result.token }).catch(() => {})
    } else chosen.value = result
  } catch (cause) { if (!disposed) failure(cause) }
  finally { busy.value = false }
}
async function verify() {
  if (busy.value || !chosen.value) return
  if (password.value.length < 8) { error.value = '请输入备份创建时的主密码，至少 8 个字符。'; return }
  busy.value = true
  error.value = ''
  try {
    const result = await callCommand('preview_backup', { token: chosen.value.token, password: password.value })
    if (!disposed) preview.value = result
  } catch (cause) { if (!disposed) failure(cause) }
  finally { password.value = ''; busy.value = false }
}
async function restore() {
  if (busy.value || !preview.value) return
  busy.value = true
  error.value = ''
  try {
    if (await backupService.restore(preview.value.token)) {
      auth.notice = '备份已恢复，请使用备份的主密码解锁。'
      await Promise.all([auth.checkStatus(), settings.load()])
    }
    close()
  } catch (cause) {
    reset()
    if (!disposed) failure(cause)
  } finally { busy.value = false }
}
onBeforeUnmount(() => { disposed = true; reset() })
</script>

<template>
  <n-button :disabled="auth.busy" @click="open">从加密备份恢复</n-button>
  <n-modal :show="show" preset="card" title="恢复加密备份" style="width: 520px; max-width: calc(100vw - 40px)" :content-style="{ maxHeight: 'calc(100dvh - 180px)', overflowY: 'auto' }" :closable="!busy" :mask-closable="!busy" :close-on-esc="!busy" @update:show="(value) => !value && close()">
    <n-alert type="warning" :show-icon="false" class="restore-notice">{{ auth.databaseError ? '恢复后使用备份创建时的主密码解锁。原数据库文件将保留在数据目录的 recovery 文件夹中。' : '恢复将整体替换当前凭证、项目、历史版本、回收站和偏好设置；覆盖前自动保留本机快照，保存失败则停止恢复。' }}</n-alert>
    <n-alert v-if="snapshotError" type="error">{{ snapshotError }}</n-alert>
    <template v-if="!chosen">
      <n-form-item label="恢复来源"><n-select v-model:value="source" :disabled="busy" :options="[{ label: '加密备份文件（.jvault）', value: 'file' }, ...snapshots.map((snapshot) => ({ label: `恢复前快照 · ${new Date(snapshot.createdAt).toLocaleString()}`, value: snapshot.id }))]" aria-label="恢复来源" /></n-form-item>
      <n-alert v-if="source !== 'file'" type="info" class="restore-notice">本机快照保留原数据库的加密范围，不能替代异地加密备份。验证时需要该快照创建时的主密码。</n-alert>
      <n-button :loading="busy" @click="choose">{{ source === 'file' ? '选择备份文件' : '选择此快照' }}</n-button>
    </template>
    <template v-else>
      <p class="backup-name">已选择：{{ chosen.name }}</p>
      <n-form v-if="!preview" @submit.prevent="verify">
        <n-form-item label="备份主密码"><n-input v-model:value="password" type="password" placeholder="备份创建时使用的主密码" :disabled="busy" autofocus /></n-form-item>
        <n-button type="primary" attr-type="submit" :loading="busy">验证并预览</n-button>
      </n-form>
      <template v-else>
        <n-alert type="success">备份已验证，尚未替换当前保险库。</n-alert>
        <dl class="backup-summary"><dt>有效凭证</dt><dd>{{ preview.itemCount }} 条</dd><dt>项目</dt><dd>{{ preview.projectCount }} 个</dd><dt>回收站</dt><dd>{{ preview.trashedCount }} 条</dd><dt>历史版本</dt><dd>{{ preview.historyCount }} 个</dd></dl>
        <n-alert type="info">恢复后仍按原删除时间清理已满 30 天的回收站条目。</n-alert>
      </template>
    </template>
    <n-alert v-if="error" type="error" class="restore-error">{{ error }}</n-alert>
    <template #footer><n-space justify="end" :wrap-item="false"><n-button :disabled="busy" @click="close">取消</n-button><n-button v-if="chosen" :disabled="busy" @click="reset">重新选择</n-button><n-button v-if="preview" type="primary" :loading="busy" @click="restore">确认替换并恢复</n-button></n-space></template>
  </n-modal>
</template>

<style scoped>
.restore-notice { margin-bottom: 20px; }
.restore-error { margin-top: 16px; }
.backup-name { overflow-wrap: anywhere; }
.backup-summary { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.backup-summary dd { margin: 0; }
</style>
