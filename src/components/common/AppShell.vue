<script setup lang="ts">
import { computed, h, onMounted, onUnmounted, ref } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { NButton, NIcon, NInput, NLayout, NLayoutHeader, NLayoutSider, NMenu, NText } from 'naive-ui'
import { ArchiveOutline, FolderOpenOutline, GridOutline, KeyOutline, LockClosedOutline, SettingsOutline, SparklesOutline, StarOutline, TimeOutline, TrashOutline, AddOutline } from '@vicons/ionicons5'
import { useAuthStore } from '../../stores/auth'
import { useDesktopStore } from '../../stores/desktop'
import { ITEM_TYPE_OPTIONS } from '../../utils/item-fields'
import BackupStatus from './BackupStatus.vue'
import { ITEM_TYPE_ICONS } from '../../utils/item-icons'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const canFilter = computed(() => route.name === 'vault' || route.name === 'projects')
const query = computed({
  get: () => typeof route.query.q === 'string' ? route.query.q : '',
  set: (q: string) => { void router.replace({ query: { ...route.query, q: q || undefined } }) },
})
const compact = window.matchMedia('(max-width: 1050px)')
const collapsed = ref(compact.matches)
const resize = () => { collapsed.value = compact.matches }
onMounted(() => compact.addEventListener('change', resize))
onUnmounted(() => compact.removeEventListener('change', resize))
const desktop = useDesktopStore()
const selectedMenu = computed(() => {
  if (route.name !== 'vault') return route.path
  const filter = route.query.filter
  if (!['categories', 'favorites', 'recent', 'trash'].includes(String(filter))) return '/vault'
  const base = `/vault?filter=${filter}`
  return filter === 'categories' && ITEM_TYPE_OPTIONS.some((option) => option.value === route.query.type) ? `${base}&type=${route.query.type}` : base
})

const menuOptions = [
  { label: () => h(RouterLink, { to: '/vault' }, { default: () => '全部条目' }), key: '/vault', icon: () => h(NIcon, null, { default: () => h(ArchiveOutline) }) },
  {
    label: () => h(RouterLink, { to: '/vault?filter=categories' }, { default: () => '分类' }), key: '/vault?filter=categories', icon: () => h(NIcon, null, { default: () => h(GridOutline) }),
    children: ITEM_TYPE_OPTIONS.map(({ label, value }) => ({
      label: () => h(RouterLink, { to: `/vault?filter=categories&type=${value}` }, { default: () => label }),
      key: `/vault?filter=categories&type=${value}`, icon: () => h(NIcon, null, { default: () => h(ITEM_TYPE_ICONS[value]) }),
    })),
  },
  { label: () => h(RouterLink, { to: '/vault?filter=favorites' }, { default: () => '收藏夹' }), key: '/vault?filter=favorites', icon: () => h(NIcon, null, { default: () => h(StarOutline) }) },
  { label: () => h(RouterLink, { to: '/vault?filter=recent' }, { default: () => '最近使用' }), key: '/vault?filter=recent', icon: () => h(NIcon, null, { default: () => h(TimeOutline) }) },
  { label: () => h(RouterLink, { to: '/vault?filter=trash' }, { default: () => '回收站' }), key: '/vault?filter=trash', icon: () => h(NIcon, null, { default: () => h(TrashOutline) }) },
  { label: () => h(RouterLink, { to: '/projects' }, { default: () => '项目' }), key: '/projects', icon: () => h(NIcon, null, { default: () => h(FolderOpenOutline) }) },
  { label: () => h(RouterLink, { to: '/generator' }, { default: () => '密码生成器' }), key: '/generator', icon: () => h(NIcon, null, { default: () => h(SparklesOutline) }) },
  { label: () => h(RouterLink, { to: '/settings' }, { default: () => '设置' }), key: '/settings', icon: () => h(NIcon, null, { default: () => h(SettingsOutline) }) },
]

async function lock() {
  await auth.lock()
}

function newItem() {
  void router.push({ name: 'vault', query: { ...(route.name === 'vault' ? route.query : {}), new: '1' } })
}
</script>

<template>
  <n-layout class="app-shell" has-sider>
    <n-layout-sider v-model:collapsed="collapsed" bordered :width="240" :collapsed-width="64" show-trigger collapse-mode="width" content-style="display: flex; flex-direction: column; min-height: 100%">
      <div class="brand"><img class="brand-mark" src="/brand/icon.svg" alt="" width="32" height="32"><div v-if="!collapsed" class="brand-name"><n-text strong>Keystill</n-text><n-text depth="3" class="brand-caption">密序 · 本地凭证管理</n-text></div></div>
      <n-menu :collapsed="collapsed" :collapsed-width="64" :value="selectedMenu" :options="menuOptions" />
      <div class="sider-footer"><n-button quaternary block aria-label="锁定保险库" @click="lock"><template #icon><n-icon><lock-closed-outline /></n-icon></template><span v-if="!collapsed">锁定保险库</span></n-button></div>
    </n-layout-sider>
    <n-layout>
      <n-layout-header bordered class="topbar">
        <n-input v-if="canFilter" v-model:value="query" clearable :placeholder="route.name === 'projects' ? '搜索当前项目…' : '搜索当前凭证…'" aria-label="筛选当前列表" class="search-input">
          <template #prefix><n-icon><key-outline /></n-icon></template>
        </n-input>
        <n-button class="global-search" quaternary @click="desktop.request('quick-search')">全局搜索 <span class="shortcut">Ctrl K</span></n-button>
        <n-button type="primary" @click="newItem"><template #icon><n-icon><add-outline /></n-icon></template>新建</n-button>
      </n-layout-header>
      <div class="page-content"><BackupStatus v-if="route.name !== 'settings'" /><slot /></div>
    </n-layout>
  </n-layout>
</template>

<style scoped>
.app-shell { height: 100vh; }
.brand { height: 76px; display: flex; align-items: center; gap: 10px; padding: 0 16px; font-size: 19px; overflow: hidden; }
.brand-mark { display: block; width: 32px; height: 32px; flex-shrink: 0; }
.brand-name { display: flex; flex-direction: column; white-space: nowrap; line-height: 1.4; }
.brand-caption { font-size: 10px; letter-spacing: .6px; margin-top: 2px; }
.sider-footer { margin-top: auto; padding: 14px 12px; }
.topbar { display: flex; align-items: center; gap: 14px; padding: 0 24px; height: 64px; }
.search-input { max-width: 560px; flex: 1; }
.global-search { margin-left: auto; }
.shortcut { margin-left: 8px; font-size: 11px; opacity: .65; }
.page-content { padding: 28px 32px; max-width: 1200px; }
</style>
