<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { NAlert, NButton, NEmpty, NInput, NModal, NSpin, NText, useMessage, type InputInst } from 'naive-ui'
import { useVaultStore } from '../../stores/vault'
import { useAuthStore } from '../../stores/auth'
import { useClipboard } from '../../composables/useClipboard'
import { matchesItem } from '../../utils/search'
import { ITEM_TYPE_LABELS } from '../../utils/item-fields'
import type { VaultItemSummary } from '../../types/vault'

const emit = defineEmits<{ (event: 'close'): void }>()
const vault = useVaultStore()
const auth = useAuthStore()
const router = useRouter()
const message = useMessage()
const { copy } = useClipboard()
const query = ref('')
const selected = ref(0)
const input = ref<InputInst | null>(null)
const resultsElement = ref<HTMLElement | null>(null)
const copying = ref(false)
const results = computed(() => vault.items.filter((item) => matchesItem(item, query.value, vault.projects)).slice(0, 50))
const active = computed(() => results.value[selected.value])

watch(results, () => { selected.value = 0 })
watch(selected, async () => {
  await nextTick()
  resultsElement.value?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
})
onMounted(async () => { input.value?.focus(); await vault.load() })

function open(item = active.value) {
  if (!item || !auth.unlocked) return
  emit('close')
  void router.push({ name: 'vault', query: { item: item.id } })
}

async function copySelected() {
  const item = active.value
  if (!item || copying.value) return
  copying.value = true
  try {
    const full = await vault.get(item.id)
    if (!full || !auth.unlocked) return
    const secret = full.password || full.fields?.apiKey || full.fields?.privateKey
    if (!secret) { message.info('此凭证没有可快捷复制的密码，请打开后选择字段。'); return }
    await copy(secret)
  } finally { copying.value = false }
}

function keydown(event: KeyboardEvent) {
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    if (results.value.length) selected.value = (selected.value + (event.key === 'ArrowDown' ? 1 : -1) + results.value.length) % results.value.length
  } else if (event.key === 'Enter') { event.preventDefault(); open() }
  else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c') { event.preventDefault(); void copySelected() }
}

function subtitle(item: VaultItemSummary) {
  return [vault.projects.find((p) => p.id === item.projectId)?.name, item.environment, item.username || item.host || item.url || ITEM_TYPE_LABELS[item.type]].filter(Boolean).join(' / ')
}
</script>

<template>
  <n-modal :show="true" preset="card" title="快捷搜索" style="width: 640px; max-width: calc(100vw - 40px)" @update:show="(show) => !show && emit('close')">
    <div @keydown="keydown">
      <n-input ref="input" v-model:value="query" placeholder="搜索名称、项目、环境、账号…" clearable :input-props="{ role: 'combobox', 'aria-controls': 'quick-search-results', 'aria-expanded': true, 'aria-activedescendant': active ? `quick-result-${active.id}` : undefined }" />
      <n-alert v-if="vault.error" type="error" class="search-state">{{ vault.error }} <n-button text @click="vault.load">重试</n-button></n-alert>
      <n-spin :show="vault.loading">
        <div id="quick-search-results" ref="resultsElement" class="results" role="listbox" aria-label="搜索结果">
          <div v-for="(item, index) in results" :id="`quick-result-${item.id}`" :key="item.id" role="option" :aria-selected="selected === index" class="result" @mousemove="selected = index" @click="open(item)">
            <n-text strong>{{ item.title }}</n-text><n-text depth="3" class="subtitle">{{ subtitle(item) }}</n-text>
          </div>
          <n-empty v-if="!vault.loading && !results.length" class="search-state" description="没有匹配的凭证" />
        </div>
      </n-spin>
      <div class="search-footer"><n-text depth="3">↑ ↓ 选择 · Enter 打开 · Ctrl C 复制密码 · Esc 关闭</n-text><n-button size="small" :disabled="!active" :loading="copying" @click="copySelected">复制密码</n-button></div>
    </div>
  </n-modal>
</template>

<style scoped>
.results { max-height: 360px; min-height: 100px; overflow-y: auto; margin: 12px 0; }
.result { padding: 12px; border-radius: 6px; cursor: pointer; }
.result[aria-selected=true] { background: rgba(138, 180, 248, .16); }
.subtitle { display: block; margin-top: 4px; font-size: 12px; overflow-wrap: anywhere; }
.search-state { margin: 20px 0; }
.search-footer { display: flex; align-items: center; justify-content: space-between; gap: 12px; font-size: 12px; }
</style>
