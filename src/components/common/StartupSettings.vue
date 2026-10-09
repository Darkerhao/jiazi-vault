<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { NAlert, NButton, NCard, NSkeleton, NSwitch, NText } from 'naive-ui'
import type { DesktopSetting, DesktopSettings } from '../../../electron/settings'
import { callCommand } from '../../services/ipc'

const preferences = ref<DesktopSettings | null>(null)
const saving = ref<DesktopSetting | null>(null)
const error = ref('')

async function load() {
  error.value = ''
  try { preferences.value = await callCommand('get_desktop_preferences') }
  catch { error.value = '读取启动与窗口设置失败，请重试。' }
}
onMounted(load)

async function update(key: DesktopSetting, value: boolean) {
  if (saving.value || !preferences.value) return
  saving.value = key
  error.value = ''
  try { preferences.value = await callCommand('set_desktop_preference', { key, value }) }
  catch {
    error.value = key === 'openAtLogin' ? '开机自启设置未生效，请检查系统登录项或启动应用权限后重试。' : '设置保存失败，请重试。'
  } finally { saving.value = null }
}
</script>

<template>
  <n-card title="启动与窗口" class="startup-card" bordered>
    <n-alert v-if="error" type="error" class="startup-error" role="alert">
      {{ error }} <n-button v-if="!preferences" text @click="load">重试</n-button>
    </n-alert>
    <template v-if="preferences">
      <div class="preference-row">
        <div><n-text id="startup-login-label">开机自启</n-text><n-text id="startup-login-description" depth="3" class="description">{{ preferences.startupSupported ? '登录电脑后自动启动 Keystill。' : '开机自启仅支持 Windows 和 macOS 的打包应用。' }}</n-text></div>
        <n-switch :value="preferences.openAtLogin" :disabled="!!saving || !preferences.startupSupported" :loading="saving === 'openAtLogin'" aria-labelledby="startup-login-label" aria-describedby="startup-login-description" @update:value="(value: boolean) => update('openAtLogin', value)" />
      </div>
      <div class="preference-row">
        <div><n-text id="startup-silent-label">静默启动</n-text><n-text id="startup-silent-description" depth="3" class="description">下次启动时不显示主窗口，在系统托盘中运行；手动启动也生效。</n-text></div>
        <n-switch :value="preferences.silentStart" :disabled="!!saving" :loading="saving === 'silentStart'" aria-labelledby="startup-silent-label" aria-describedby="startup-silent-description" @update:value="(value: boolean) => update('silentStart', value)" />
      </div>
      <div class="preference-row">
        <div><n-text id="startup-close-label">关闭时最小化到托盘</n-text><n-text id="startup-close-description" depth="3" class="description">开启后，关闭窗口会锁定保险库并隐藏到托盘；关闭此项后，关闭窗口将直接退出。</n-text></div>
        <n-switch :value="preferences.closeToTray" :disabled="!!saving" :loading="saving === 'closeToTray'" aria-labelledby="startup-close-label" aria-describedby="startup-close-description" @update:value="(value: boolean) => update('closeToTray', value)" />
      </div>
      <n-text depth="3" class="startup-hint">设置自动保存。通过托盘菜单可重新打开窗口或退出应用；首次使用和数据恢复时仍会显示窗口。</n-text>
    </template>
    <n-skeleton v-else-if="!error" text :repeat="3" />
  </n-card>
</template>

<style scoped>
.startup-card { margin-top: 24px; max-width: 700px; }
.startup-error { margin-bottom: 16px; }
.preference-row { display: flex; align-items: center; justify-content: space-between; gap: 24px; padding: 16px 0; }
.preference-row:first-of-type { padding-top: 0; }
.preference-row + .preference-row { border-top: 1px solid var(--n-border-color); }
.preference-row .n-switch { flex-shrink: 0; }
.description { display: block; margin-top: 4px; font-size: 13px; line-height: 1.6; }
.startup-hint { display: block; margin-top: 4px; font-size: 12px; line-height: 1.6; }
</style>
