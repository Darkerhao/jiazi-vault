<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { NAlert, NButton, NCard, NIcon, NText, useMessage } from 'naive-ui'
import { BookOutline, ChatbubbleEllipsesOutline, CopyOutline, LogoGithub, OpenOutline } from '@vicons/ionicons5'
import AppShell from '../components/common/AppShell.vue'
import AppUpdates from '../components/common/AppUpdates.vue'
import { useClipboard } from '../composables/useClipboard'
import { callCommand } from '../services/ipc'
import type { AppInfo, AppLink } from '../../electron/contracts'

const router = useRouter()
const message = useMessage()
const { copy } = useClipboard()
const info = ref<AppInfo | null>(null)
const loading = ref(false)
const error = ref('')
const platformNames: Record<string, string> = { win32: 'Windows', darwin: 'macOS', linux: 'Linux' }
const environment = computed(() => info.value ? [
  { label: '应用版本', value: `Keystill ${info.value.version}` },
  { label: '操作系统', value: `${platformNames[info.value.platform] ?? info.value.platform} ${info.value.systemVersion}` },
  { label: '系统架构', value: info.value.arch },
  { label: 'Electron', value: info.value.electronVersion },
  { label: 'Chromium', value: info.value.chromiumVersion },
  { label: 'Node.js', value: info.value.nodeVersion },
] : [])
const resources = [
  { target: 'guide', label: '使用文档', description: '快速上手、快捷键与备份指南', icon: BookOutline },
  { target: 'project', label: '项目主页', description: '查看源代码与项目动态', icon: LogoGithub },
  { target: 'feedback', label: '问题反馈', description: '报告问题或提出改进建议', icon: ChatbubbleEllipsesOutline },
] satisfies { target: AppLink; label: string; description: string; icon: typeof BookOutline }[]

async function loadInfo() {
  loading.value = true
  error.value = ''
  try { info.value = await callCommand('get_app_info') }
  catch { error.value = '无法读取版本信息，请重试。' }
  finally { loading.value = false }
}
async function openLink(target: AppLink) {
  try { await callCommand('open_app_link', { target }) }
  catch { message.error('无法打开浏览器，请稍后重试。') }
}
onMounted(loadInfo)
</script>

<template>
  <AppShell>
    <div class="page-heading"><n-text depth="3">认识 Keystill</n-text><h1>关于</h1></div>
    <div class="about-content">
      <n-card class="about-brand" bordered>
        <div class="product-heading">
          <img src="/brand/icon.svg" alt="" width="64" height="64">
          <div><h2>Keystill <n-text depth="3" class="product-name">密序</n-text></h2><n-text depth="3">密钥有序，专注如常。</n-text></div>
          <n-text v-if="info" class="product-version">v{{ info.version }}</n-text>
          <n-text v-else-if="loading" depth="3" class="product-version">正在读取版本…</n-text>
        </div>
        <p class="product-description">面向开发者的本地凭证管理工具，集中管理账号密码、API Key、SSH 密钥与环境变量。</p>
        <n-alert v-if="error" type="error">{{ error }} <n-button text :loading="loading" @click="loadInfo">重新加载</n-button></n-alert>
      </n-card>

      <AppUpdates />

      <n-card title="帮助与反馈" bordered>
        <div class="resource-grid">
          <div v-for="resource in resources" :key="resource.target" class="resource">
            <n-button block @click="openLink(resource.target)">
              <template #icon><n-icon><component :is="resource.icon" /></n-icon></template>
              {{ resource.label }}<n-icon class="external-icon" :size="14"><open-outline /></n-icon>
            </n-button>
            <n-text depth="3">{{ resource.description }}</n-text>
          </div>
        </div>
        <div class="diagnostics">
          <div><n-text strong>反馈时附上版本信息</n-text><p><n-text depth="3">仅复制应用版本与系统环境，不包含凭证、主密码或本地文件路径。</n-text></p></div>
          <n-button :disabled="!info" @click="copy(environment.map(({ label, value }) => `${label}：${value}`).join('\n'))">
            <template #icon><n-icon><copy-outline /></n-icon></template>复制诊断信息
          </n-button>
        </div>
        <details v-if="info" class="environment">
          <summary>查看运行环境</summary>
          <dl><div v-for="entry in environment" :key="entry.label"><dt><n-text depth="3">{{ entry.label }}</n-text></dt><dd>{{ entry.value }}</dd></div></dl>
        </details>
      </n-card>

      <n-card title="数据与隐私" bordered>
        <p class="privacy-description">凭证保存在本机，密码、备注等敏感字段加密存储；名称、用户名等元数据以明文保存。应用不提供云端同步或主密码找回。</p>
        <n-text depth="3">检查更新时访问 GitHub，不上传保险库数据。建议定期创建加密备份，并保存在另一块磁盘或外部设备。</n-text>
        <div class="privacy-actions"><n-button @click="router.push('/settings')">查看安全与备份设置</n-button></div>
      </n-card>
    </div>
  </AppShell>
</template>

<style scoped>
.page-heading h1 { margin: 4px 0 24px; font-size: 26px; }
.about-content { display: grid; gap: 20px; max-width: 960px; }
.product-heading { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
.product-heading img { flex-shrink: 0; }
.product-heading h2 { margin: 0 0 4px; font-size: 26px; line-height: 1.3; }
.product-name { margin-left: 8px; font-size: 16px; font-weight: 400; }
.product-version { margin-left: auto; font-size: 14px; font-variant-numeric: tabular-nums; }
.product-description { margin: 20px 0 0; line-height: 1.8; }
.about-brand :deep(.n-alert) { margin-top: 16px; }
.resource-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; }
.resource { display: grid; gap: 8px; min-width: 0; }
.resource > .n-text { font-size: 12px; }
.external-icon { margin-left: 8px; }
.diagnostics { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin-top: 24px; }
.diagnostics p { margin: 4px 0 0; font-size: 12px; }
.environment { margin-top: 16px; }
.environment summary { cursor: pointer; }
.environment dl { margin: 12px 0 0; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px 24px; }
.environment dl > div { display: flex; gap: 16px; }
.environment dt { min-width: 70px; }
.environment dd { margin: 0; overflow-wrap: anywhere; min-width: 0; }
.privacy-description { margin-top: 0; line-height: 1.8; }
.privacy-actions { margin-top: 16px; }
@media (max-width: 720px) {
  .resource-grid, .environment dl { grid-template-columns: 1fr; }
}
</style>
