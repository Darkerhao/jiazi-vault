<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { NAlert, NButton, NCard, NText } from 'naive-ui'
import { callCommand } from '../../services/ipc'
import type { AppUpdate } from '../../../electron/app-update'

const version = ref('')
const checking = ref(false)
const checked = ref(false)
const update = ref<AppUpdate | null>(null)
const error = ref('')
onMounted(async () => {
  try { version.value = await callCommand('get_app_version') }
  catch { error.value = '无法读取当前版本，请重新打开设置。' }
})

async function check() {
  checking.value = true
  checked.value = false
  update.value = null
  error.value = ''
  try {
    update.value = await callCommand('check_for_updates')
    checked.value = true
  } catch (cause) {
    error.value = String(cause).includes('UPDATE_RATE_LIMITED')
      ? '检查过于频繁，请稍后重试，或直接打开官方下载页。'
      : '暂时无法检查更新，请检查网络后重试，或直接打开官方下载页。'
  } finally { checking.value = false }
}

async function openReleasePage() {
  try { await callCommand('open_release_page') }
  catch { error.value = '无法打开浏览器，请稍后重试。' }
}
</script>

<template>
  <n-card title="关于与更新" class="updates-card" bordered>
    <p class="version">Keystill · 密序 <span v-if="version">v{{ version }}</span></p>
    <n-text depth="3">点击检查时连接 GitHub，仅查询公开版本信息，不上传保险库数据。</n-text>
    <div class="update-actions">
      <n-button :loading="checking" :disabled="!version" @click="check">检查更新</n-button>
      <n-button @click="openReleasePage">打开官方下载页</n-button>
    </div>
    <n-alert v-if="error" type="error">{{ error }}</n-alert>
    <n-alert v-else-if="checked" :type="update?.newer ? 'info' : 'success'">
      {{ !update ? '暂未发布正式版本。' : update.newer ? `发现新版本 v${update.version}` : '当前已是最新版本。' }}
    </n-alert>
    <details v-if="update" class="release-notes">
      <summary>查看 v{{ update.version }} 更新说明</summary>
      <pre>{{ update.notes }}</pre>
    </details>
    <p class="update-hint"><n-text depth="3">更新前建议创建加密备份，退出应用后运行新版本安装包。下载与安装由你手动完成。</n-text></p>
  </n-card>
</template>

<style scoped>
.updates-card { max-width: 700px; margin-top: 24px; }
.version { margin-top: 0; font-weight: 600; }
.update-actions { display: flex; gap: 12px; flex-wrap: wrap; margin: 16px 0; }
.release-notes { margin-top: 16px; }
.release-notes summary { cursor: pointer; }
.release-notes pre { white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; max-height: 240px; overflow-y: auto; }
.update-hint { margin-bottom: 0; }
</style>
