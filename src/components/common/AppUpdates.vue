<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { NAlert, NButton, NCard, NProgress, NText } from 'naive-ui'
import { callCommand } from '../../services/ipc'
import type { UpdateState } from '../../../electron/app-update'

const version = ref('')
const state = ref<UpdateState | null>(null)
const busy = computed(() => !!state.value && ['checking', 'downloading', 'confirming', 'installing'].includes(state.value.status))
const update = computed(() => state.value?.update)
const error = ref('')
let unsubscribe: (() => void) | undefined
onMounted(async () => {
  unsubscribe = window.jiaziVault?.onUpdateState((value) => { state.value = value })
  try {
    const [currentVersion, currentState] = await Promise.all([callCommand('get_app_version'), callCommand('get_update_state')])
    version.value = currentVersion
    state.value ??= currentState
  } catch { error.value = '无法读取更新状态，请重新打开设置。' }
})
onUnmounted(() => unsubscribe?.())

async function check() {
  error.value = ''
  try {
    await callCommand('check_for_updates')
  } catch (cause) {
    error.value = String(cause).includes('VAULT_BUSY')
      ? '保险库操作尚未完成，请完成后重试更新。'
      : '暂时无法检查更新，请检查网络后重试，或直接打开官方下载页。'
  }
}

async function openReleasePage() {
  try { await callCommand('open_release_page') }
  catch { error.value = '无法打开浏览器，请稍后重试。' }
}
</script>

<template>
  <n-card title="关于与更新" class="updates-card" bordered>
    <p class="version">Keystill · 密序 <span v-if="version">v{{ version }}</span></p>
    <n-text depth="3">点击检查时连接 GitHub，{{ state?.automatic ? '发现新版后自动下载安装包；如有未保存内容，会先确认再退出并启动安装向导。' : '查询公开版本信息。' }}不上传保险库数据。</n-text>
    <div class="update-actions">
      <n-button :loading="busy" :disabled="!version || !state || busy" @click="check">{{ state?.status === 'ready' ? '安装已下载的更新' : state?.status === 'error' ? '重试更新' : '检查更新' }}</n-button>
      <n-button @click="openReleasePage">打开官方下载页</n-button>
    </div>
    <n-alert v-if="error || state?.error" type="error">{{ error || state?.error }}</n-alert>
    <n-alert v-else-if="state?.status === 'downloading'" type="info">
      正在下载 v{{ update?.version }}，完成后自动开始安装。
      <n-progress type="line" :percentage="state.percent" :processing="true" aria-label="更新下载进度" />
    </n-alert>
    <n-alert v-else-if="state?.status === 'installing'" type="info">下载完成，正在退出应用并启动安装向导…</n-alert>
    <n-alert v-else-if="state?.status === 'confirming'" type="info">更新已下载，正在确认未保存的内容…</n-alert>
    <n-alert v-else-if="state?.status === 'ready'" type="info">更新已下载，保存完成后可继续安装。</n-alert>
    <n-alert v-else-if="state && ['current', 'available'].includes(state.status)" :type="update?.newer ? 'info' : 'success'">
      {{ !update ? '暂未发布正式版本。' : update.newer ? `发现新版本 v${update.version}` : '当前已是最新版本。' }}
    </n-alert>
    <details v-if="update" class="release-notes">
      <summary>查看 v{{ update.version }} 更新说明</summary>
      <pre>{{ update.notes }}</pre>
    </details>
    <p class="update-hint"><n-text depth="3">更新前建议创建加密备份。{{ state?.automatic ? '安装完成页默认勾选“打开应用”，点击“完成”即可启动新版；取消勾选则保持关闭。' : '当前平台或便携版请从官方下载页下载并手动安装。' }}</n-text></p>
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
