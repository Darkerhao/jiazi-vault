<script setup lang="ts">
import { computed, h } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { NButton, NIcon, NInput, NLayout, NLayoutHeader, NLayoutSider, NMenu, NText } from 'naive-ui'
import { ArchiveOutline, FolderOpenOutline, GridOutline, KeyOutline, LockClosedOutline, SettingsOutline, SparklesOutline, StarOutline, TimeOutline, TrashOutline, AddOutline } from '@vicons/ionicons5'
import { useAuthStore } from '../../stores/auth'
import { useVaultStore } from '../../stores/vault'
import { useDesktopStore } from '../../stores/desktop'
import { ITEM_TYPE_OPTIONS } from '../../utils/item-fields'
import { ITEM_TYPE_ICONS } from '../../utils/item-icons'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const vault = useVaultStore()
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
  void router.push({ name: 'vault', query: { ...route.query, new: '1' } })
}
</script>

<template>
  <n-layout class="app-shell" has-sider>
    <n-layout-sider bordered :width="240" :collapsed-width="64" show-trigger collapse-mode="width" content-style="display: flex; flex-direction: column; min-height: 100%">
      <div class="brand"><img class="brand-mark" src="/brand/icon.svg" alt="" width="32" height="32"><n-text strong>Jiazi Vault</n-text></div>
      <n-menu :value="selectedMenu" :options="menuOptions" />
      <div class="sider-footer"><n-button quaternary block @click="lock"><template #icon><n-icon><lock-closed-outline /></n-icon></template>锁定保险库</n-button></div>
    </n-layout-sider>
    <n-layout>
      <n-layout-header bordered class="topbar">
        <n-input v-model:value="vault.query" clearable placeholder="搜索凭证…" class="search-input">
          <template #prefix><n-icon><key-outline /></n-icon></template>
        </n-input>
        <n-button quaternary @click="desktop.request('quick-search')">快捷搜索 <span class="shortcut">Ctrl K</span></n-button>
        <n-button type="primary" @click="newItem"><template #icon><n-icon><add-outline /></n-icon></template>新建</n-button>
      </n-layout-header>
      <div class="page-content"><slot /></div>
    </n-layout>
  </n-layout>
</template>

<style scoped>
.app-shell { height: 100vh; }
.brand { height: 64px; display: flex; align-items: center; gap: 10px; padding: 0 20px; font-size: 16px; }
.brand-mark { display: block; width: 32px; height: 32px; flex-shrink: 0; }
.sider-footer { margin-top: auto; padding: 14px 12px; }
.topbar { display: flex; align-items: center; gap: 14px; padding: 0 24px; height: 64px; }
.search-input { max-width: 560px; flex: 1; }
.shortcut { margin-left: 8px; font-size: 11px; opacity: .65; }
.page-content { padding: 28px 32px; max-width: 1200px; }
</style>
