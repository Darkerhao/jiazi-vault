<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { NAlert, NButton, NEmpty, NIcon, NList, NListItem, NPagination, NSelect, NSpin, NTag, NText, useDialog, useMessage } from 'naive-ui'
import { KeyOutline, Star, StarOutline, TrashOutline } from '@vicons/ionicons5'
import AppShell from '../components/common/AppShell.vue'
import ItemFormModal from '../components/item/ItemFormModal.vue'
import { useVaultStore } from '../stores/vault'
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
const projectId = computed(() => typeof route.query.project === 'string' ? route.query.project : undefined)
const environment = computed(() => ENVIRONMENT_OPTIONS.some((o) => o.value === route.query.environment) ? route.query.environment as Environment : undefined)
const currentProject = computed(() => vault.projects.find((p) => p.id === projectId.value))
const itemType = computed(() => ITEM_TYPE_OPTIONS.some((option) => option.value === route.query.type) ? route.query.type as ItemType : undefined)
const displayedItems = computed(() => vault.filteredItems.filter((item) => (!projectId.value || item.projectId === projectId.value) && (!environment.value || item.environment === environment.value) && (!itemType.value || item.type === itemType.value)))
const page = ref(1)
const pageSize = 25
const pageItems = computed(() => displayedItems.value.slice((page.value - 1) * pageSize, page.value * pageSize))
watch([() => vault.query, () => vault.filter, projectId, environment, itemType], () => { page.value = 1 })
watch(() => displayedItems.value.length, (count) => { page.value = Math.min(page.value, Math.max(1, Math.ceil(count / pageSize))) })

function setFilter(key: 'project' | 'environment' | 'type', value: string | null) {
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
    </div>
    <n-alert v-if="vault.error" type="error">{{ vault.error }} <n-button text @click="vault.load">重试</n-button></n-alert>

    <n-spin :show="vault.loading">
      <n-empty v-if="!vault.loading && displayedItems.length === 0" :description="vault.query || projectId || environment || itemType ? '没有匹配的凭证' : emptyDescription" class="empty">
        <template #icon><n-icon><key-outline /></n-icon></template>
      </n-empty>

      <n-list v-else bordered class="item-list">
        <n-list-item v-for="item in pageItems" :key="item.id">
          <div class="item-row">
            <n-icon :size="24" aria-hidden="true"><component :is="ITEM_TYPE_ICONS[item.type]" /></n-icon>
            <div class="item-main" @click="openEdit(item)">
              <div class="item-title"><n-text strong>{{ item.title }}</n-text></div>
              <div class="item-sub"><n-text depth="3">{{ subtitle(item) }}</n-text></div>
              <div v-if="vault.filter === 'recent' && item.lastAccessedAt !== undefined" class="item-sub"><n-text depth="3">最近使用：{{ new Date(item.lastAccessedAt).toLocaleString() }}</n-text></div>
              <div v-if="vault.filter === 'trash' && item.deletedAt !== undefined" class="item-sub"><n-text depth="3">自动删除：{{ new Date(item.deletedAt + 30 * 24 * 60 * 60 * 1000).toLocaleString() }}</n-text></div>
            </div>
            <div class="item-actions">
              <n-tag v-if="item.projectId" size="small">{{ vault.projects.find((p) => p.id === item.projectId)?.name }}</n-tag>
              <n-tag v-if="item.environment" size="small" :type="item.environment === 'production' ? 'error' : 'default'">{{ item.environment }}</n-tag>
              <n-tag size="small" :bordered="false">{{ ITEM_TYPE_LABELS[item.type] }}</n-tag>
              <template v-if="vault.filter === 'trash'">
                <n-button quaternary size="small" @click="restore(item)">恢复</n-button>
                <n-button quaternary circle size="small" @click="removePermanently(item)"><template #icon><n-icon><trash-outline /></n-icon></template></n-button>
              </template>
              <template v-else>
                <n-button quaternary circle size="small" @click="toggle(item)"><template #icon><n-icon><star v-if="item.favorite" /><star-outline v-else /></n-icon></template></n-button>
                <n-button quaternary circle size="small" @click="remove(item)"><template #icon><n-icon><trash-outline /></n-icon></template></n-button>
              </template>
            </div>
          </div>
        </n-list-item>
      </n-list>
      <div v-if="displayedItems.length" class="pagination">
        <n-text depth="3">共 {{ displayedItems.length }} 条</n-text>
        <n-pagination v-model:page="page" :page-size="pageSize" :item-count="displayedItems.length" :page-slot="5" show-quick-jumper />
      </div>
    </n-spin>

    <ItemFormModal v-if="modalShow" :key="editing?.id ?? 'new'" :show="modalShow" :item="editing" :draft="{ type: itemType, projectId, environment }" @close="closeEditor" />
  </AppShell>
</template>

<style scoped>
.page-heading h1 { margin: 4px 0 24px; font-size: 26px; }
.filters { display: flex; gap: 12px; max-width: 860px; margin-bottom: 20px; }
.retention-notice { max-width: 860px; margin-bottom: 20px; }
.item-list { max-width: 860px; }
.pagination { display: flex; justify-content: space-between; align-items: center; gap: 12px; max-width: 860px; margin-top: 16px; }
.item-row { display: flex; align-items: center; gap: 14px; width: 100%; }
.item-main { flex: 1; cursor: pointer; min-width: 0; }
.item-title { margin-bottom: 2px; }
.item-sub { font-size: 13px; }
.item-actions { display: flex; align-items: center; gap: 8px; }
.empty { padding: 80px 0 8px; }
</style>
