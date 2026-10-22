<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { NAlert, NButton, NIcon, NModal, NSpin, NText, useMessage } from 'naive-ui'
import { OpenOutline, SparklesOutline } from '@vicons/ionicons5'
import { callCommand } from '../../services/ipc'
import type { AppRelease } from '../../../electron/app-update'

const emit = defineEmits<{ close: [] }>()
const message = useMessage()
const show = ref(true)
const releases = ref<AppRelease[]>([])
const loading = ref(true)
const error = ref('')
async function load() {
  loading.value = true
  error.value = ''
  try { releases.value = await callCommand('get_recent_releases') }
  catch (cause) {
    error.value = /UPDATE_RATE_LIMITED/.test(String(cause))
      ? '请求过于频繁，请稍后重试，或查看完整更新内容。'
      : '无法加载近期更新，请检查网络后重试。'
  } finally { loading.value = false }
}
async function openRelease(tag?: string) {
  try { await callCommand('open_app_link', tag ? { target: 'release', tag } : { target: 'history' }) }
  catch { message.error('无法打开浏览器，请稍后重试。') }
}
const formatDate = (value: string) => new Date(value).toLocaleDateString('zh-CN')
onMounted(load)
</script>

<template>
  <n-modal v-model:show="show" preset="card" style="width: min(720px, calc(100vw - 32px))" aria-label="近期更新" :bordered="false" @after-leave="emit('close')">
    <template #header><div class="recent-heading"><n-icon><sparkles-outline /></n-icon>近期更新</div></template>
    <div class="release-list" :aria-busy="loading">
      <div v-if="loading" class="release-empty" role="status"><n-spin size="small" /><n-text depth="3">正在加载更新内容…</n-text></div>
      <n-alert v-else-if="error" type="error">{{ error }} <n-button text @click="load">重试</n-button></n-alert>
      <n-text v-else-if="!releases.length" depth="3" class="release-empty">暂未发布正式版本。</n-text>
      <article v-for="release in releases" v-else :key="release.tag" class="release-entry">
        <div class="release-heading">
          <h3>v{{ release.version }}</h3>
          <n-text v-if="release.publishedAt" depth="3" class="release-date">{{ formatDate(release.publishedAt) }}</n-text>
          <n-button text :aria-label="`查看 v${release.version} 详情`" @click="openRelease(release.tag)">详情<n-icon class="external-icon" :size="14"><open-outline /></n-icon></n-button>
        </div>
        <pre>{{ release.notes }}</pre>
      </article>
    </div>
    <template #footer><div class="recent-actions"><n-button @click="openRelease()">查看完整更新内容</n-button><n-button type="primary" @click="show = false">知道了</n-button></div></template>
  </n-modal>
</template>

<style scoped>
.recent-heading { display: flex; align-items: center; gap: 10px; }
.release-list { max-height: min(60vh, 600px); overflow-y: auto; padding-right: 8px; }
.release-empty { display: flex; align-items: center; justify-content: center; gap: 12px; padding: 32px 0; }
.release-entry + .release-entry { margin-top: 28px; }
.release-heading { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.release-heading h3 { margin: 0; font-size: 17px; }
.release-heading .n-button { margin-left: auto; }
.release-date { font-size: 12px; }
.release-entry pre { white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; line-height: 1.8; margin: 12px 0 0; }
.external-icon { margin-left: 6px; }
.recent-actions { display: flex; justify-content: flex-end; gap: 12px; flex-wrap: wrap; }
</style>
