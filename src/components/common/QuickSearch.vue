<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { NAlert, NButton, NEmpty, NIcon, NInput, NModal, NSpin, NText, type InputInst } from 'naive-ui'
import { useVaultStore } from '../../stores/vault'
import { useAuthStore } from '../../stores/auth'
import { useClipboard } from '../../composables/useClipboard'
import { ITEM_TYPE_LABELS, TYPE_FIELDS } from '../../utils/item-fields'
import { vaultService } from '../../services/vault'
import { ITEM_TYPE_ICONS } from '../../utils/item-icons'
import type { VaultItem, VaultItemSummary } from '../../types/vault'

const emit = defineEmits<{ (event: 'close'): void }>()
const vault = useVaultStore()
const auth = useAuthStore()
const router = useRouter()
const { copy, copyItem } = useClipboard()
const query = ref('')
const selected = ref(0)
const input = ref<InputInst | null>(null)
const resultsElement = ref<HTMLElement | null>(null)
const copying = ref(false)
const results = computed(() => vault.search(vault.items, query.value, 50))
const active = computed(() => results.value[selected.value])
const details = ref<VaultItem | null>(null)
const fieldsLoading = ref(false)
const fieldsError = ref('')
const selectedField = ref('primary')
let request = 0
const copyFields = computed(() => {
  const item = details.value
  if (!item) return []
  const fields: { key: string; label: string; value: string }[] = []
  for (const key of ['username', 'password', 'host', 'port', 'url', 'notes'] as const) {
    const value = item[key]
    if (value !== undefined && value !== '') fields.push({ key, label: TYPE_FIELDS[item.type].find((field) => field.target === key)?.label ?? ({ username: '用户名', password: '密码', host: '主机', port: '端口', url: 'URL', notes: '备注' })[key], value: String(value) })
  }
  for (const [key, value] of Object.entries(item.fields ?? {})) {
    if (value || item.type === 'env') fields.push({ key: `field:${key}`, label: TYPE_FIELDS[item.type].find((field) => field.target === 'field' && field.key === key)?.label ?? key, value })
  }
  return fields
})

async function loadFields() {
  const current = ++request
  const revision = auth.sessionRevision
  const id = active.value?.id
  details.value = null
  fieldsError.value = ''
  selectedField.value = 'primary'
  fieldsLoading.value = !!id
  if (!id) return
  try {
    const item = await vaultService.getItem(id, false)
    if (current !== request || revision !== auth.sessionRevision) return
    if (!item) throw new Error('ITEM_NOT_FOUND')
    details.value = item
  } catch {
    if (current === request && revision === auth.sessionRevision) fieldsError.value = '读取字段失败，请重试。'
  } finally { if (current === request) fieldsLoading.value = false }
}
watch(() => active.value?.id, loadFields, { immediate: true })
onBeforeUnmount(() => { request++; details.value = null })

watch(query, () => { selected.value = 0 })
watch(results, (items, previous) => {
  const id = previous[selected.value]?.id
  selected.value = Math.max(0, items.findIndex((item) => item.id === id))
})
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
  if (!item || copying.value || fieldsLoading.value || !auth.unlocked) return
  const field = copyFields.value.find((field) => field.key === selectedField.value)
  copying.value = true
  try {
    if (selectedField.value === 'primary') await copyItem(item.id)
    else if (field && details.value?.id === item.id) await copy(field.value, item.id)
  }
  finally { copying.value = false }
}

function keydown(event: KeyboardEvent) {
  if ((event.target as HTMLElement).closest('select, button')) return
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    if (results.value.length) selected.value = (selected.value + (event.key === 'ArrowDown' ? 1 : -1) + results.value.length) % results.value.length
  } else if (event.key === 'Enter') { event.preventDefault(); open() }
  else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c') { event.preventDefault(); void copySelected() }
}

function subtitle(item: VaultItemSummary) {
  return [vault.projects.find((p) => p.id === item.projectId)?.name, item.environment, item.username || item.host || item.url].filter(Boolean).join(' / ')
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
            <n-icon :size="24" aria-hidden="true"><component :is="ITEM_TYPE_ICONS[item.type]" /></n-icon>
            <div class="result-content"><n-text strong>{{ item.title }}</n-text><n-text depth="3" class="subtitle">{{ subtitle(item) }}</n-text></div>
            <n-text depth="3" class="result-type">{{ ITEM_TYPE_LABELS[item.type] }}</n-text>
          </div>
          <n-empty v-if="!vault.loading && !results.length" class="search-state" description="没有匹配的凭证" />
        </div>
      </n-spin>
      <n-alert v-if="fieldsError" type="error">{{ fieldsError }} <n-button text @click="loadFields">重试</n-button></n-alert>
      <div class="search-footer">
        <n-text depth="3">↑ ↓ 选择 · Enter 打开 · Ctrl C 复制 · Esc 关闭</n-text>
        <div class="copy-controls">
          <select v-model="selectedField" aria-label="选择复制字段" :disabled="!details || fieldsLoading || copying">
            <option value="primary">{{ active?.type === 'env' ? '完整 .env（需确认）' : '默认内容' }}</option>
            <option v-for="field in copyFields" :key="field.key" :value="field.key">{{ field.label }}</option>
          </select>
          <n-button size="small" :disabled="!active || fieldsLoading || !!fieldsError" :loading="copying" @click="copySelected">复制</n-button>
        </div>
      </div>
    </div>
  </n-modal>
</template>

<style scoped>
.results { max-height: 360px; min-height: 100px; overflow-y: auto; margin: 12px 0; }
.result { display: flex; align-items: center; gap: 12px; padding: 12px; border-radius: 6px; cursor: pointer; }
.result-content { flex: 1; min-width: 0; }
.result-type { flex-shrink: 0; font-size: 12px; }
.result[aria-selected=true] { background: rgba(108, 140, 58, .16); }
.subtitle { display: block; margin-top: 4px; font-size: 12px; overflow-wrap: anywhere; }
.search-state { margin: 20px 0; }
.search-footer { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; font-size: 12px; }
.copy-controls { display: flex; align-items: center; gap: 8px; }
.copy-controls select { max-width: 220px; min-width: 120px; height: 30px; border-radius: 6px; padding: 0 8px; color: inherit; background: var(--n-color); border: 1px solid var(--n-border-color); color-scheme: light dark; }
</style>
