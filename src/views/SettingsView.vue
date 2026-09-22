<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { NAlert, NButton, NCard, NForm, NFormItem, NSelect, NSpace, NText, useMessage } from 'naive-ui'
import AppShell from '../components/common/AppShell.vue'
import BackupRestore from '../components/common/BackupRestore.vue'
import PlaintextTransfer from '../components/common/PlaintextTransfer.vue'
import { useSettingsStore } from '../stores/settings'
import { backupService } from '../services/backup'
import { callCommand } from '../services/ipc'
import type { AppSettings } from '../../electron/settings'

const settings = useSettingsStore()
const message = useMessage()
const backingUp = ref(false)
const shortcut = ref<{ shortcut: string; shortcutRegistered: boolean } | null>(null)
onMounted(async () => { shortcut.value = await callCommand('get_desktop_status') })
const themeOptions = [
  { label: '跟随系统', value: 'system' },
  { label: '浅色', value: 'light' },
  { label: '深色', value: 'dark' },
]
const clipboardOptions = [
  { label: '从不', value: 'never' },
  ...[5, 10, 15, 30, 60].map((value) => ({ label: `${value} 秒`, value })),
]
const autoLockOptions = [
  { label: '从不', value: 0 },
  ...[5, 15, 30, 60].map((value) => ({ label: `${value} 分钟`, value })),
]
function updateAutoLock(value: number) {
  void settings.update({ autoLockMinutes: value === 0 ? null : value as AppSettings['autoLockMinutes'] })
}

async function createBackup() {
  if (backingUp.value) return
  backingUp.value = true
  try {
    const name = await backupService.create()
    if (name) message.success(`加密备份已保存：${name}`)
  } catch { message.error('备份保存失败，请检查目标位置权限，或重新解锁后重试。') }
  finally { backingUp.value = false }
}
</script>

<template>
  <AppShell>
    <div class="page-heading"><n-text depth="3">偏好设置</n-text><h1>设置</h1></div>
    <n-card class="settings-card" bordered>
      <n-alert v-if="settings.error" type="error" class="settings-error">{{ settings.error }} <n-button v-if="!settings.preferences" text @click="settings.load">重试</n-button></n-alert>
      <n-form v-if="settings.preferences" label-placement="left" label-width="180" :disabled="settings.busy">
        <n-form-item label="主题"><n-select :value="settings.preferences.themeMode" :options="themeOptions" @update:value="(value) => settings.update({ themeMode: value })" /></n-form-item>
        <n-form-item label="剪贴板清除时间"><n-select :value="settings.preferences.clipboardClearTimeout" :options="clipboardOptions" @update:value="(value) => settings.update({ clipboardClearTimeout: value })" /></n-form-item>
        <n-form-item label="自动锁定"><n-select :value="settings.preferences.autoLockMinutes ?? 0" :options="autoLockOptions" @update:value="updateAutoLock" /></n-form-item>
      </n-form>
      <n-text depth="3">设置自动保存。无操作或切换应用后按所选时间锁定；系统锁屏、休眠时立即锁定。锁定和退出时也会清理本应用复制的内容。</n-text>
    </n-card>
    <n-card title="加密备份与恢复" class="settings-card backup-card" bordered>
      <n-text depth="3">备份包含全部凭证、项目、回收站和设置，使用当前主密码加密。恢复时需要备份创建时的主密码。</n-text>
      <n-space class="backup-actions">
        <n-button type="primary" :loading="backingUp" @click="createBackup">创建加密备份</n-button>
        <BackupRestore />
      </n-space>
    </n-card>
    <PlaintextTransfer />
    <n-card title="快捷键与托盘" class="settings-card backup-card" bordered>
      <n-alert v-if="shortcut && !shortcut.shortcutRegistered" type="warning">{{ shortcut.shortcut }} 注册失败，可能已被其他应用占用。可使用托盘菜单或应用内 Ctrl K 打开搜索。</n-alert>
      <n-text v-else-if="shortcut">全局快捷搜索：{{ shortcut.shortcut }}</n-text>
      <p>应用内：Ctrl K 搜索 · Ctrl N 新建凭证 · Ctrl Shift N 新建项目 · Ctrl G 生成密码 · Ctrl Shift L 锁定（macOS 使用 ⌘）。</p>
      <n-text depth="3">关闭窗口会锁定并留在系统托盘。双击托盘图标可重新打开；使用托盘菜单“退出”结束应用。</n-text>
    </n-card>
  </AppShell>
</template>

<style scoped>
.page-heading h1 { margin: 4px 0 24px; font-size: 26px; }
.settings-card { max-width: 700px; }
.settings-error { margin-bottom: 16px; }
.backup-card { margin-top: 24px; }
.backup-actions { margin-top: 20px; }
</style>
