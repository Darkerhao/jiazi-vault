<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { NAlert, NButton, NCard, NForm, NFormItem, NInput, NSelect, NSpace, NText } from 'naive-ui'
import AppShell from '../components/common/AppShell.vue'
import BackupRestore from '../components/common/BackupRestore.vue'
import PlaintextTransfer from '../components/common/PlaintextTransfer.vue'
import VaultSecurity from '../components/common/VaultSecurity.vue'
import { useSettingsStore } from '../stores/settings'
import BackupStatus from '../components/common/BackupStatus.vue'
import AutomaticBackup from '../components/common/AutomaticBackup.vue'
import AppUpdates from '../components/common/AppUpdates.vue'
import { callCommand } from '../services/ipc'
import { DEFAULT_SEARCH_SHORTCUT, validateSearchShortcut, type AppSettings } from '../../electron/settings'

const settings = useSettingsStore()
const shortcut = ref<{ shortcut: string | null; shortcutRegistered: boolean } | null>(null)
const shortcutDraft = ref<string | null>(null), shortcutError = ref(''), shortcutBusy = ref(false)
const shortcutLabel = (value: string | null) => value?.replace('CommandOrControl', navigator.platform.includes('Mac') ? '⌘' : 'Ctrl').replace(/\+/g, ' + ') ?? '已停用'
onMounted(async () => {
  try { shortcut.value = await callCommand('get_desktop_status'); shortcutDraft.value = shortcut.value.shortcut }
  catch { shortcutError.value = '读取快捷键失败，请重新进入设置。' }
})
function recordShortcut(event: KeyboardEvent) {
  if (event.key === 'Tab') return
  event.preventDefault()
  event.stopPropagation()
  if (!(event.ctrlKey || event.metaKey) || !(event.altKey || event.shiftKey) || !/^(Key[A-Z]|Digit[0-9])$/.test(event.code)) {
    shortcutError.value = '请按 Ctrl（macOS 为 ⌘）+ Alt 或 Shift + 字母/数字。'
    return
  }
  const value = `CommandOrControl+${event.altKey ? 'Alt+' : ''}${event.shiftKey ? 'Shift+' : ''}${event.code.replace(/^(Key|Digit)/, '')}`
  try { validateSearchShortcut(value) }
  catch { shortcutError.value = '此组合已用于应用内操作，请使用其他快捷键。'; return }
  shortcutError.value = ''
  shortcutDraft.value = value
}
async function saveShortcut(value: string | null) {
  if (shortcutBusy.value) return
  shortcutBusy.value = true
  shortcutError.value = ''
  try { shortcut.value = await callCommand('set_search_shortcut', { shortcut: value }); shortcutDraft.value = shortcut.value.shortcut }
  catch { shortcutError.value = '保存快捷键失败，请重试。' }
  finally { shortcutBusy.value = false }
}
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
    <VaultSecurity />
    <n-card title="本地加密的保护范围" class="settings-card backup-card" bordered>
      <p>密码、备注和自定义字段（包括私钥、API Key、环境变量）经过加密保存。主密码不以明文保存。</p>
      <p>凭证名称、用户名、URL、主机、端口、标签、项目名称和使用时间等元数据以明文保存在本地数据库中。获得数据库文件的人可能读取这些信息；锁定保险库不会加密这些元数据。</p>
      <n-text depth="3">加密备份会加密上述全部业务数据。应用不提供云端同步或主密码找回。</n-text>
    </n-card>
    <n-card title="加密备份与恢复" class="settings-card backup-card" bordered>
      <BackupStatus detailed><BackupRestore /></BackupStatus>
      <AutomaticBackup />
    </n-card>
    <PlaintextTransfer />
    <n-card title="快捷键与托盘" class="settings-card backup-card" bordered>
      <n-alert v-if="shortcutError" type="error">{{ shortcutError }}</n-alert>
      <n-alert v-if="shortcut?.shortcut && !shortcut.shortcutRegistered" type="warning">{{ shortcutLabel(shortcut.shortcut) }} 注册失败，可能已被其他应用占用。请更换快捷键；也可使用托盘菜单或应用内 Ctrl K。</n-alert>
      <n-text v-if="shortcut">全局快捷搜索：{{ shortcutLabel(shortcut.shortcut) }}</n-text>
      <n-input :value="shortcutLabel(shortcutDraft)" readonly placeholder="点击后按下新快捷键" :input-props="{ 'aria-label': '全局搜索快捷键' }" :disabled="shortcutBusy" class="shortcut-input" @keydown="recordShortcut" />
      <n-space>
        <n-button :loading="shortcutBusy" :disabled="!shortcut" @click="saveShortcut(shortcutDraft)">保存快捷键</n-button>
        <n-button :disabled="shortcutBusy || !shortcut" @click="saveShortcut(null)">停用</n-button>
        <n-button :disabled="shortcutBusy || !shortcut" @click="saveShortcut(DEFAULT_SEARCH_SHORTCUT)">恢复默认</n-button>
      </n-space>
      <p>应用内：Ctrl K 搜索 · Ctrl N 新建凭证 · Ctrl Shift N 新建项目 · Ctrl G 生成密码 · Ctrl Shift L 锁定（macOS 使用 ⌘）。</p>
      <n-text depth="3">关闭窗口会锁定并留在系统托盘。双击托盘图标可重新打开；使用托盘菜单“退出”结束应用。</n-text>
    </n-card>
    <AppUpdates />
  </AppShell>
</template>

<style scoped>
.page-heading h1 { margin: 4px 0 24px; font-size: 26px; }
.settings-card { max-width: 700px; }
.settings-error { margin-bottom: 16px; }
.backup-card { margin-top: 24px; }
.shortcut-input { margin: 12px 0; }
</style>
