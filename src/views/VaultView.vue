<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { NAlert, NButton, NEmpty, NIcon, NList, NListItem, NPagination, NSelect, NSpin, NTag, NText, useDialog, useMessage } from 'naive-ui'
import { CopyOutline, KeyOutline, Star, StarOutline, TrashOutline } from '@vicons/ionicons5'
import { expiryState } from '../../electron/expiry'
import AppShell from '../components/common/AppShell.vue'
import ItemFormModal from '../components/item/ItemFormModal.vue'
import { useVaultStore } from '../stores/vault'
import { useClipboard } from '../composables/useClipboard'
import { ENVIRONMENT_OPTIONS, ITEM_TYPE_LABELS, ITEM_TYPE_OPTIONS } from '../utils/item-fields'
import { ITEM_TYPE_ICONS } from '../utils/item-icons'
import { projectService } from '../services/project'
import type { Environment, ItemType, VaultItem, VaultItemSummary } from '../types/vault'

const route = useRoute()
const router = useRouter()
const vault = useVaultStore()
const dialog = useDialog()
const message = useMessage()

const modalShow = ref(false)
const editing = ref<VaultItem | null>(null)
const newEditorKey = ref(0)
const projectId = computed(() => typeof route.query.project === 'string' ? route.query.project : undefined)
const environment = computed(() => ENVIRONMENT_OPTIONS.some((o) => o.value === route.query.environment) ? route.query.environment as Environment : undefined)
const currentProject = computed(() => vault.projects.find((p) => p.id === projectId.value))
const itemType = computed(() => ITEM_TYPE_OPTIONS.some((option) => option.value === route.query.type) ? route.query.type as ItemType : undefined)
const query = computed(() => typeof route.query.q === 'string' ? route.query.q : '')
const expiry = computed(() => ['expired', 'soon', 'invalid'].includes(String(route.query.expiry)) ? String(route.query.expiry) : null)
const now = ref(new Date())
const clock = setInterval(() => { now.value = new Date() }, 60_000)
onUnmounted(() => clearInterval(clock))
const expiryOptions = [{ label: '已过期', value: 'expired' }, { label: '7 天内到期', value: 'soon' }, { label: '日期待修正', value: 'invalid' }]
const displayedItems = computed(() => vault.search(vault.filteredItems, query.value).filter((item) => (!expiry.value || expiryState(item.expiresAt, now.value) === expiry.value) && (!projectId.value || item.projectId === projectId.value) && (!environment.value || item.environment === environment.value) && (!itemType.value || item.type === itemType.value)))
const page = ref(1)
const pageSize = 25
const pageItems = computed(() => displayedItems.value.slice((page.value - 1) * pageSize, page.value * pageSize))
watch([query, () => vault.filter, projectId, environment, itemType, expiry], () => { page.value = 1 })
watch(() => displayedItems.value.length, (count) => { page.value = Math.min(page.value, Math.max(1, Math.ceil(count / pageSize))) })

function setFilter(key: 'project' | 'environment' | 'type' | 'expiry', value: string | null) {
  void router.push({ name: 'vault', query: { ...route.query, [key]: value || undefined } })
}
watch(projectId, async (id) => {
  if (!id) return
  try { await projectService.visit(id) }
  catch { message.error('项目不存在或无法访问') }
}, { immediate: true })

const heading = computed(() => {
  if (currentProject.value) return currentProject.value.name
  switch (vault.filter) {
    case 'categories': return itemType.value ? ITEM_TYPE_LABELS[itemType.value] : '分类'
    case 'favorites': return '收藏夹'
    case 'recent': return '最近使用'
    case 'trash': return '回收站'
    default: return '全部条目'
  }
})

const emptyDescription = computed(() => {
  switch (vault.filter) {
    case 'favorites': return '还没有收藏的凭证'
    case 'recent': return '还没有最近使用记录'
    case 'trash': return '回收站是空的'
    default: return '还没有凭证'
  }
})

function syncFilter() {
  const value = route.query.filter
  vault.filter = value === 'categories' || value === 'favorites' || value === 'recent' || value === 'trash' ? value : 'all'
}

watch(() => route.query.filter, syncFilter, { immediate: true })
watch(
  () => route.query.new,
  (value) => {
    if (!value) return
    editing.value = null
    newEditorKey.value++
    modalShow.value = true
    const query = { ...route.query }
    delete query.new
    void router.replace({ name: 'vault', query })
  },
  { immediate: true },
)

watch(() => route.query.item, async (id) => {
  if (typeof id !== 'string') return
  const full = await vault.get(id)
  if (full) { editing.value = full; modalShow.value = true }
  else message.error('无法打开凭证')
  const query = { ...route.query }
  delete query.item
  void router.replace({ name: 'vault', query })
}, { immediate: true })
onMounted(() => vault.load())

function closeEditor() { modalShow.value = false; editing.value = null }

function subtitle(item: VaultItemSummary) {
  return item.username || item.url || item.host || ITEM_TYPE_LABELS[item.type]
}

async function openEdit(item: VaultItemSummary) {
  const full = await vault.get(item.id)
  if (!full) return
  editing.value = full
  modalShow.value = true
}

async function toggle(item: VaultItemSummary) {
  if (!(await vault.toggleFavorite(item.id))) message.error('操作失败，请重试')
}

const { copyItem } = useClipboard()
const copyingId = ref<string | null>(null)
async function copyRow(item: VaultItemSummary) {
  if (copyingId.value) return
  copyingId.value = item.id
  try { await copyItem(item.id) }
  finally { copyingId.value = null }
}

function remove(item: VaultItemSummary) {
  dialog.warning({
    title: '删除凭证',
    content: `确定删除「${item.title}」吗？删除后会移入回收站。`,
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: async () => {
      if (!(await vault.removeItem(item.id))) message.error('删除失败，请重试')
    },
  })
}

function removePermanently(item: VaultItemSummary) {
  dialog.error({
    title: '彻底删除',
    content: `确定永久删除「${item.title}」吗？此操作无法撤销。`,
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: async () => {
      if (!(await vault.removeItem(item.id, true))) message.error('删除失败，请重试')
    },
  })
}

async function restore(item: VaultItemSummary) {
  if (!(await vault.restoreItem(item.id))) message.error('恢复失败，请重试')
}
</script>

<template>
  <AppShell>
    <section class="page-heading">
      <div><n-text depth="3">保险库</n-text><h1>{{ heading }}</h1></div>
    </section>
    <n-alert v-if="vault.filter === 'trash'" type="info" class="retention-notice">凭证移入回收站满 30 天后自动永久删除，无法恢复。</n-alert>

    <div class="filters">
      <n-select :value="itemType ?? null" :options="ITEM_TYPE_OPTIONS" clearable placeholder="全部类型" aria-label="凭证类型筛选" @update:value="(value) => setFilter('type', value)" />
      <n-select :value="projectId ?? null" :options="vault.projects.map((p) => ({ label: p.name, value: p.id }))" clearable filterable placeholder="全部项目" @update:value="(value) => setFilter('project', value)" />
      <n-select :value="environment ?? null" :options="ENVIRONMENT_OPTIONS" clearable placeholder="全部环境" @update:value="(value) => setFilter('environment', value)" />
      <n-select :value="expiry" :options="expiryOptions" clearable placeholder="全部有效期" aria-label="有效期筛选" @update:value="(value) => setFilter('expiry', value)" />
    </div>
    <n-alert v-if="vault.error" type="error">{{ vault.error }} <n-button text @click="vault.load">重试</n-button></n-alert>

    <n-spin :show="vault.loading">
      <n-empty v-if="!vault.loading && displayedItems.length === 0" :description="query || projectId || environment || itemType || expiry ? '没有匹配的凭证' : emptyDescription" class="empty">
        <template #icon><n-icon><key-outline /></n-icon></template>
        <template #extra>
          <n-button v-if="query || projectId || environment || itemType || expiry" @click="router.replace({ name: 'vault', query: { filter: route.query.filter } })">清除筛选</n-button>
          <n-button v-else-if="vault.filter === 'all'" type="primary" @click="router.push({ query: { new: '1' } })">新建第一条凭证</n-button>
        </template>
      </n-empty>

      <n-list v-else bordered class="item-list">
        <n-list-item v-for="item in pageItems" :key="item.id">
          <div class="item-row">
            <n-icon :size="24" aria-hidden="true"><component :is="ITEM_TYPE_ICONS[item.type]" /></n-icon>
            <div class="item-main">
              <n-button text class="item-title" @click="openEdit(item)">{{ item.title }}</n-button>
              <div class="item-sub"><n-text depth="3">{{ subtitle(item) }}</n-text></div>
              <div class="item-meta"><n-tag v-if="item.expiresAt" size="small" :type="expiryState(item.expiresAt, now) === 'expired' ? 'error' : ['soon', 'invalid'].includes(expiryState(item.expiresAt, now)) ? 'warning' : 'default'">{{ expiryState(item.expiresAt, now) === 'invalid' ? '日期待修正' : `${expiryState(item.expiresAt, now) === 'expired' ? '已过期' : expiryState(item.expiresAt, now) === 'soon' ? '即将到期' : '到期'}：${item.expiresAt}` }}</n-tag>              <n-tag v-if="item.projectId" size="small">{{ vault.projects.find((p) => p.id === item.projectId)?.name }}</n-tag>
              <n-tag v-if="item.environment" size="small" :type="item.environment === 'production' ? 'error' : 'default'">{{ ENVIRONMENT_OPTIONS.find((option) => option.value === item.environment)?.label }}</n-tag>
              <n-tag size="small" :bordered="false">{{ ITEM_TYPE_LABELS[item.type] }}</n-tag>
</div>
              <div v-if="vault.filter === 'recent' && item.lastAccessedAt !== undefined" class="item-sub"><n-text depth="3">最近使用：{{ new Date(item.lastAccessedAt).toLocaleString() }}</n-text></div>
              <div v-if="vault.filter === 'trash' && item.deletedAt !== undefined" class="item-sub"><n-text depth="3">自动删除：{{ new Date(item.deletedAt + 30 * 24 * 60 * 60 * 1000).toLocaleString() }}</n-text></div>
            </div>
            <div class="item-actions">
              <template v-if="vault.filter === 'trash'">
                <n-button quaternary size="small" @click="restore(item)">恢复</n-button>
                <n-button quaternary circle size="small" aria-label="彻底删除凭证" @click="removePermanently(item)"><template #icon><n-icon><trash-outline /></n-icon></template></n-button>
              </template>
              <template v-else>
                <n-button quaternary circle size="small" :loading="copyingId === item.id" :aria-label="`复制${item.title}`" @click="copyRow(item)"><template #icon><n-icon><copy-outline /></n-icon></template></n-button>
                <n-button quaternary circle size="small" :aria-label="item.favorite ? '取消收藏' : '收藏凭证'" @click="toggle(item)"><template #icon><n-icon><star v-if="item.favorite" /><star-outline v-else /></n-icon></template></n-button>
                <n-button quaternary circle size="small" aria-label="删除凭证" @click="remove(item)"><template #icon><n-icon><trash-outline /></n-icon></template></n-button>
              </template>
            </div>
          </div>
        </n-list-item>
      </n-list>
      <div v-if="displayedItems.length" class="pagination">
        <n-text depth="3">共 {{ displayedItems.length }} 条</n-text>
        <n-pagination v-if="displayedItems.length > pageSize" v-model:page="page" :page-size="pageSize" :item-count="displayedItems.length" :page-slot="5" show-quick-jumper />
      </div>
    </n-spin>

    <ItemFormModal v-if="modalShow" :key="editing?.id ?? `new-${newEditorKey}`" :show="modalShow" :item="editing" :draft="{ type: itemType, projectId, environment }" @close="closeEditor" />
  </AppShell>
</template>

<style scoped>
.page-heading h1 { margin: 4px 0 24px; font-size: 26px; }
.filters { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; max-width: 860px; margin-bottom: 20px; }
.retention-notice { max-width: 860px; margin-bottom: 20px; }
.item-list { max-width: 860px; }
.pagination { display: flex; justify-content: space-between; align-items: center; gap: 12px; max-width: 860px; margin-top: 16px; }
.item-row { display: flex; align-items: center; gap: 14px; width: 100%; }
.item-main { flex: 1; min-width: 0; }
.item-title { max-width: 100%; height: auto; margin-bottom: 4px; font-weight: 600; font-size: 15px; text-align: left; white-space: normal; overflow-wrap: anywhere; }
.item-meta { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.item-meta :deep(.n-tag__content) { max-width: 240px; overflow: hidden; text-overflow: ellipsis; }
.item-sub { font-size: 13px; overflow-wrap: anywhere; }
.item-actions { flex-shrink: 0; display: flex; align-items: center; gap: 8px; }
.empty { padding: 80px 0 8px; }
</style>
