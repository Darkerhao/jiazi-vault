<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { NButton, NEmpty, NIcon, NList, NListItem, NSpin, NTag, NText, useDialog, useMessage } from 'naive-ui'
import { KeyOutline, Star, StarOutline, TrashOutline } from '@vicons/ionicons5'
import AppShell from '../components/common/AppShell.vue'
import ItemFormModal from '../components/item/ItemFormModal.vue'
import { useVaultStore } from '../stores/vault'
import { ITEM_TYPE_LABELS } from '../utils/item-fields'
import type { VaultItem, VaultItemSummary } from '../types/vault'

const route = useRoute()
const router = useRouter()
const vault = useVaultStore()
const dialog = useDialog()
const message = useMessage()

const modalShow = ref(false)
const editing = ref<VaultItem | null>(null)

const heading = computed(() => {
  switch (vault.filter) {
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
  vault.filter = value === 'favorites' || value === 'recent' || value === 'trash' ? value : 'all'
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

onMounted(() => vault.load())

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

    <n-spin :show="vault.loading">
      <n-empty v-if="!vault.loading && vault.filteredItems.length === 0" :description="emptyDescription" class="empty">
        <template #icon><n-icon><key-outline /></n-icon></template>
      </n-empty>

      <n-list v-else bordered class="item-list">
        <n-list-item v-for="item in vault.filteredItems" :key="item.id">
          <div class="item-row">
            <div class="item-main" @click="openEdit(item)">
              <div class="item-title"><n-text strong>{{ item.title }}</n-text></div>
              <div class="item-sub"><n-text depth="3">{{ subtitle(item) }}</n-text></div>
            </div>
            <div class="item-actions">
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
    </n-spin>

    <ItemFormModal :show="modalShow" :item="editing" @close="modalShow = false" />
  </AppShell>
</template>

<style scoped>
.page-heading h1 { margin: 4px 0 24px; font-size: 26px; }
.item-list { max-width: 860px; }
.item-row { display: flex; align-items: center; gap: 14px; width: 100%; }
.item-main { flex: 1; cursor: pointer; min-width: 0; }
.item-title { margin-bottom: 2px; }
.item-sub { font-size: 13px; }
.item-actions { display: flex; align-items: center; gap: 8px; }
.empty { padding: 80px 0 8px; }
</style>
