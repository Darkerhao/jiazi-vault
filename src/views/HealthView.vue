<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { NAlert, NButton, NEmpty, NPagination, NSelect, NTag, NText } from 'naive-ui'
import AppShell from '../components/common/AppShell.vue'
import { useAuthStore } from '../stores/auth'
import { useVaultStore } from '../stores/vault'
import { callCommand } from '../services/ipc'
import { ITEM_TYPE_LABELS } from '../utils/item-fields'
import { vaultErrorMessage } from '../utils/vault-error'
import type { CredentialHealthEntry, CredentialHealthIssue } from '../../electron/contracts'

const router = useRouter(), auth = useAuthStore(), vault = useVaultStore()
const entries = ref<CredentialHealthEntry[]>([])
const loading = ref(false), error = ref(''), checkedAt = ref<Date | null>(null)
const filter = ref<CredentialHealthIssue | null>(null), page = ref(1)
const pageSize = 25
let disposed = false
const labels: Record<CredentialHealthIssue, string> = {
  'short-password': '密码少于 12 个字符',
  'reused-password': '密码重复使用',
  expired: 'API Key 已过期',
  expiring: 'API Key 7 天内到期',
  'invalid-expiry': '到期日期待修正',
}
const filterOptions = Object.entries(labels).map(([value, label]) => ({ value, label }))
const itemIndex = computed(() => new Map(vault.items.map(item => [item.id, item])))
const rows = computed(() => entries.value.flatMap(entry => {
  const item = itemIndex.value.get(entry.id)
  return item && (!filter.value || entry.issues.includes(filter.value)) ? [{ ...entry, item }] : []
}))
const pageRows = computed(() => rows.value.slice((page.value - 1) * pageSize, page.value * pageSize))
watch(filter, () => { page.value = 1 })
watch(() => rows.value.length, count => { page.value = Math.min(page.value, Math.max(1, Math.ceil(count / pageSize))) })

async function load() {
  if (loading.value) return
  loading.value = true
  error.value = ''
  entries.value = []
  checkedAt.value = null
  const revision = auth.sessionRevision
  try {
    await vault.load()
    if (disposed || revision !== auth.sessionRevision) return
    if (vault.error) { error.value = vault.error; return }
    const result = await callCommand('get_credential_health')
    if (disposed || revision !== auth.sessionRevision) return
    entries.value = result
    checkedAt.value = new Date()
  } catch (cause) {
    if (!disposed && revision === auth.sessionRevision) error.value = vaultErrorMessage(cause, '检查失败，请重试。')
  } finally { if (!disposed) loading.value = false }
}
onMounted(load)
onBeforeUnmount(() => { disposed = true; entries.value = [] })
</script>

<template>
  <AppShell>
    <div class="health-heading">
      <div><n-text depth="3">本地基础检查</n-text><h1>凭证健康</h1></div>
      <n-button :loading="loading" @click="load">重新检查</n-button>
    </div>
    <n-text depth="3">检查有效凭证中的短密码、重复使用密码和 API Key 到期情况。密码仅在本机检查，不展示、不上传；不包含回收站，也不查询泄漏数据库。</n-text>
    <n-alert v-if="error" type="error" class="health-state">{{ error }} <n-button text @click="load">重试</n-button></n-alert>
    <n-text v-if="checkedAt" depth="3" class="checked-at">检查于 {{ checkedAt.toLocaleString() }} · {{ entries.length }} 条凭证需要关注。未发现问题不代表密码安全。</n-text>
    <div class="health-filter">
      <n-select v-model:value="filter" :options="filterOptions" clearable placeholder="全部问题" aria-label="筛选健康问题" :disabled="loading" />
      <n-text depth="3">{{ rows.length }} 条</n-text>
    </div>
    <div v-for="row in pageRows" :key="row.id" class="health-row">
      <div class="health-entry">
        <n-text strong>{{ row.item.title }}</n-text>
        <n-text depth="3">{{ ITEM_TYPE_LABELS[row.item.type] }}<template v-if="row.item.projectId"> · {{ vault.projects.find(project => project.id === row.item.projectId)?.name }}</template></n-text>
        <div class="health-issues"><n-tag v-for="issue in row.issues" :key="issue" size="small" :type="issue === 'expired' ? 'error' : 'warning'">{{ labels[issue] }}</n-tag></div>
      </div>
      <n-button :aria-label="`处理凭证${row.item.title}`" @click="router.push({ name: 'vault', query: { item: row.id } })">查看与修改</n-button>
    </div>
    <n-empty v-if="checkedAt && !rows.length" class="health-state" :description="filter ? '没有符合该问题类型的凭证' : '本次基础检查未发现问题'" />
    <n-text v-if="loading" class="health-state">正在本地检查…</n-text>
    <n-pagination v-if="rows.length > pageSize" v-model:page="page" :page-size="pageSize" :item-count="rows.length" show-quick-jumper class="health-pagination" />
  </AppShell>
</template>

<style scoped>
.health-heading { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.health-heading h1 { margin: 4px 0 20px; font-size: 26px; }
.checked-at { display: block; margin-top: 12px; }
.health-filter { display: flex; align-items: center; gap: 16px; margin: 24px 0 12px; }
.health-filter .n-select { max-width: 300px; }
.health-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 18px 0; border-bottom: 1px solid rgba(128, 128, 128, .16); }
.health-entry { display: flex; flex-direction: column; gap: 6px; min-width: 0; overflow-wrap: anywhere; }
.health-issues { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 4px; }
.health-row > .n-button { flex-shrink: 0; }
.health-state { margin: 24px 0; }
.health-pagination { margin-top: 24px; }
</style>
