<script setup lang="ts">
import { computed, ref } from 'vue'
import { NAlert, NButton, NCard, NIcon, NProgress, NText } from 'naive-ui'
import { SparklesOutline } from '@vicons/ionicons5'
import { callCommand } from '../../services/ipc'
import { useUpdatesStore } from '../../stores/updates'
import RecentUpdates from './RecentUpdates.vue'

const updates = useUpdatesStore()
const state = computed(() => updates.state)
const update = computed(() => state.value?.update)
const showRecent = ref(false)
const actionLabel = computed(() => {
  if (state.value?.status === 'ready') return '安装已下载的更新'
  if (updates.hasUpdate) return state.value?.status === 'error' ? '重试更新' : `更新到 v${update.value?.version}`
  return state.value?.status === 'error' ? '重试检查' : '检查更新'
})
function updateAction() {
  if (!updates.hasUpdate) return updates.run('check_for_updates')
  return state.value?.automatic ? updates.run('install_update') : openReleasePage()
}
async function openReleasePage() {
  updates.error = ''
  try { await callCommand('open_app_link', { target: 'releases' }) }
  catch { updates.error = '无法打开浏览器，请稍后重试。' }
}
</script>

<template>
  <n-card title="软件更新" class="updates-card" bordered>
    <n-text depth="3">启动时及运行期间每 6 小时自动检查新版本，发现更新后在「关于」菜单显示红点。{{ state?.automatic ? '点击更新后开始下载并安装。' : '点击更新前往官方下载页手动安装。' }}</n-text>
    <p v-if="updates.hasUpdate" class="available-update" role="status">检测到新版本：<n-text strong>v{{ update?.version }}</n-text></p>
    <div class="update-actions">
      <n-button type="primary" :loading="updates.busy" :disabled="!state || updates.busy" @click="updateAction">{{ actionLabel }}</n-button>
      <n-button v-if="updates.hasUpdate" :disabled="updates.busy || state?.status === 'ready'" @click="updates.run('check_for_updates')">重新检查</n-button>
      <n-button @click="showRecent = true"><template #icon><n-icon><sparkles-outline /></n-icon></template>近期更新</n-button>
      <n-button @click="openReleasePage">打开官方下载页</n-button>
    </div>
    <n-alert v-if="updates.error || state?.error" type="error">{{ updates.error || state?.error }} <n-button v-if="!state" text @click="updates.load">重新加载</n-button></n-alert>
    <n-alert v-else-if="state?.status === 'downloading'" type="info">
      正在下载 v{{ update?.version }}，完成后自动开始安装。
      <n-progress type="line" :percentage="state.percent" :processing="true" aria-label="更新下载进度" />
    </n-alert>
    <n-alert v-else-if="state?.status === 'installing'" type="info">下载完成，正在退出应用并启动安装向导…</n-alert>
    <n-alert v-else-if="state?.status === 'confirming'" type="info">更新已下载，正在确认未保存的内容…</n-alert>
    <n-alert v-else-if="state?.status === 'ready'" type="info">更新已下载，保存完成后可继续安装。</n-alert>
    <n-alert v-else-if="state?.status === 'current'" type="success">
      {{ update ? '当前已是最新版本。' : '暂未发布正式版本。' }}
    </n-alert>
    <details v-if="update" class="release-notes">
      <summary>查看 v{{ update.version }} 更新说明</summary>
      <pre>{{ update.notes }}</pre>
    </details>
    <p class="update-hint"><n-text depth="3">更新前建议创建加密备份。{{ state?.automatic ? '安装完成页默认勾选“打开应用”，点击“完成”即可启动新版；取消勾选则保持关闭。' : '当前平台或便携版请从官方下载页下载并手动安装。' }}</n-text></p>
  </n-card>
  <RecentUpdates v-if="showRecent" @close="showRecent = false" />
</template>

<style scoped>
.update-actions { display: flex; gap: 12px; flex-wrap: wrap; margin: 16px 0; }
.available-update { margin: 16px 0 0; }
.release-notes { margin-top: 16px; }
.release-notes summary { cursor: pointer; }
.release-notes pre { white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; max-height: 240px; overflow-y: auto; }
.update-hint { margin-bottom: 0; }
</style>
