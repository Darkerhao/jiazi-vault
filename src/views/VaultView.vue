<script setup lang="ts">
import { onMounted } from 'vue'
import { NEmpty, NGrid, NGridItem, NIcon, NList, NListItem, NTag, NText } from 'naive-ui'
import { KeyOutline } from '@vicons/ionicons5'
import AppShell from '../components/common/AppShell.vue'
import { useVaultStore } from '../stores/vault'

const vault = useVaultStore()
onMounted(() => vault.load())
</script>

<template>
  <AppShell>
    <section class="page-heading"><div><n-text depth="3">保险库</n-text><h1>全部条目</h1></div></section>
    <n-empty v-if="!vault.loading && vault.filteredItems.length === 0" description="还没有凭证" class="empty"><template #icon><n-icon><key-outline /></n-icon></template></n-empty>
    <n-list v-else bordered class="item-list">
      <n-list-item v-for="item in vault.filteredItems" :key="item.id">
        <div class="item-row"><div class="item-icon"><n-icon><key-outline /></n-icon></div><div class="item-main"><n-text strong>{{ item.title }}</n-text><n-text depth="3">{{ item.username || item.url || item.type }}</n-text></div><n-tag v-if="item.environment" size="small" :type="item.environment === 'production' ? 'error' : 'default'">{{ item.environment }}</n-tag></div>
      </n-list-item>
    </n-list>
    <n-grid v-if="!vault.loading && vault.filteredItems.length === 0" :cols="1" class="empty-cta"><n-grid-item><n-text depth="3">创建第一条凭证，开始管理你的机密信息。</n-text></n-grid-item></n-grid>
  </AppShell>
</template>

<style scoped>
.page-heading h1 { margin: 4px 0 24px; font-size: 26px; }
.item-list { max-width: 860px; }
.item-row { display: flex; align-items: center; gap: 14px; width: 100%; }
.item-icon { width: 34px; height: 34px; display: grid; place-items: center; border-radius: 8px; background: rgba(138,180,248,.16); color: #8ab4f8; }
.item-main { display: flex; flex-direction: column; gap: 3px; flex: 1; }
.empty { padding: 80px 0 8px; }
.empty-cta { max-width: 420px; text-align: center; margin: 0 auto; }
</style>
