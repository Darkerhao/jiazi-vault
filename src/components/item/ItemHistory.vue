<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { NAlert, NButton, NCheckbox, NSelect, NTag, NText, useDialog, useMessage } from 'naive-ui'
import { callCommand } from '../../services/ipc'
import { useAuthStore } from '../../stores/auth'
import { useVaultStore } from '../../stores/vault'
import { ENVIRONMENT_OPTIONS, ITEM_TYPE_LABELS, TYPE_FIELDS } from '../../utils/item-fields'
import { diffItemHistory, type HistoryValue } from '../../utils/item-history'
import type { ItemHistorySummary, VaultItem } from '../../../electron/contracts'

const props = defineProps<{ item: VaultItem; canRestore: boolean }>()
const emit = defineEmits<{ restored: [] }>()
const auth = useAuthStore(), vault = useVaultStore(), dialog = useDialog(), message = useMessage()
const open = ref(false), busy = ref(false), error = ref('')
const versions = ref<ItemHistorySummary[]>([]), selected = ref<number | null>(null)
const preview = ref<VaultItem | null>(null), revealed = ref<string[]>([])
const onlyChanges = ref(true)
let disposed = false, request = 0
let dismiss: (() => void) | undefined
const labels: Record<string, string> = { title: '名称', type: '类型', projectId: '项目', environment: '环境', username: '用户名', password: '密码', url: 'URL', host: '主机', port: '端口', notes: '备注', tags: '标签' }
const changeLabels = { added: '新增', removed: '删除', changed: '修改', unchanged: '未变化' } as const
const fields = computed(() => {
  if (!preview.value) return []
  return diffItemHistory(preview.value, props.item).map(field => {
    const name = field.key.slice('field:'.length)
    const label = field.key.startsWith('field:')
      ? [...TYPE_FIELDS[preview.value!.type], ...TYPE_FIELDS[props.item.type]].find(entry => entry.target === 'field' && entry.key === name)?.label ?? name
      : labels[field.key]
    return { ...field, label, hidden: !['title', 'type', 'projectId', 'environment', 'tags'].includes(field.key) }
  })
})
const changedCount = computed(() => fields.value.filter(field => field.kind !== 'unchanged').length)
const visibleFields = computed(() => fields.value.filter(field => !onlyChanges.value || field.kind !== 'unchanged'))
function formatValue(key: string, value: HistoryValue): string {
  if (value === undefined) return '（不存在）'
  if (key === 'type') return ITEM_TYPE_LABELS[value as VaultItem['type']]
  if (key === 'projectId') return vault.projects.find(project => project.id === value)?.name || '原项目已删除'
  if (key === 'environment') return ENVIRONMENT_OPTIONS.find(option => option.value === value)?.label ?? String(value)
  if (Array.isArray(value)) return value.join('、') || '（无）'
  return String(value) || '（空值）'
}
function close() {
  request++
  open.value = false
  busy.value = false
  preview.value = null
  selected.value = null
  revealed.value = []
}
async function load() {
  open.value = true
  busy.value = true
  error.value = ''
  const current = ++request, revision = auth.sessionRevision
  try {
    const result = await callCommand('list_item_history', { id: props.item.id })
    if (!disposed && current === request && revision === auth.sessionRevision) versions.value = result
  } catch { if (!disposed && current === request && revision === auth.sessionRevision) error.value = '历史版本读取失败，请重试。' }
  finally { if (current === request) busy.value = false }
}
async function select(id: number) {
  selected.value = id
  preview.value = null
  revealed.value = []
  error.value = ''
  busy.value = true
  const current = ++request, revision = auth.sessionRevision
  try {
    const item = await callCommand('get_item_history', { id: props.item.id, historyId: id })
    if (!disposed && current === request && revision === auth.sessionRevision) preview.value = item
  } catch { if (!disposed && current === request && revision === auth.sessionRevision) error.value = '无法读取此版本，请重试。' }
  finally { if (current === request) busy.value = false }
}
function restore() {
  const historyId = selected.value
  if (!historyId || busy.value) return
  const prompt = dialog.warning({
    title: '恢复历史版本？', content: '当前内容会先保留为新的历史版本。收藏状态和使用记录保持不变；历史项目已删除时恢复为未分配项目。',
    positiveText: '确认恢复版本', negativeText: '取消',
    onPositiveClick: async () => {
      if (disposed || !auth.unlocked || busy.value) return false
      busy.value = true
      const revision = auth.sessionRevision
      try {
        await callCommand('restore_item_history', { id: props.item.id, historyId })
        if (disposed || revision !== auth.sessionRevision) return
        await vault.load()
        if (disposed || revision !== auth.sessionRevision) return
        message.success('已恢复历史版本')
        emit('restored')
      } catch { if (!disposed && revision === auth.sessionRevision) error.value = '恢复失败，当前内容未被替换，请重试。' }
      finally { busy.value = false }
    },
  })
  dismiss = prompt.destroy
}
onBeforeUnmount(() => { disposed = true; request++; preview.value = null; revealed.value = []; dismiss?.() })
</script>

<template>
  <section class="item-history">
    <n-button :loading="busy" @click="open ? close() : load()">{{ open ? '收起历史版本' : '历史版本' }}</n-button>
    <div v-if="open" class="history-content">
      <n-text depth="3">保留最近 20 次修改前的完整内容，历史版本均加密保存。永久删除凭证会一并删除历史。</n-text>
      <n-alert v-if="error" type="error">{{ error }} <n-button text @click="selected ? select(selected) : load()">重试</n-button></n-alert>
      <n-text v-if="!busy && !versions.length && !error" depth="3">暂无历史版本，下次修改保存后会自动保留。</n-text>
      <n-select v-if="versions.length" :value="selected" :options="versions.map((version, index) => ({ value: version.id, label: `${new Date(version.savedAt).toLocaleString()} · 修改前版本 ${versions.length - index}` }))" placeholder="选择历史版本" aria-label="选择历史版本" :disabled="busy" @update:value="select" />
      <template v-if="preview">
        <n-text strong>与当前保存内容对比 · {{ changedCount }} 个字段变化</n-text>
        <n-text depth="3">从所选历史版本到当前内容的变化；恢复会使用左侧历史值。</n-text>
        <n-checkbox v-model:checked="onlyChanges" label="仅显示变化" />
        <n-text v-if="!changedCount" depth="3">此版本与当前保存内容一致。</n-text>
        <div v-for="field in visibleFields" :key="field.key" class="history-field" :data-field="field.key">
          <div class="history-field-heading">
            <n-text strong>{{ field.label }}</n-text>
            <n-tag size="small" :type="field.kind === 'added' ? 'success' : field.kind === 'removed' ? 'error' : field.kind === 'changed' ? 'warning' : 'default'">{{ changeLabels[field.kind] }}</n-tag>
            <n-button v-if="field.hidden" size="small" :aria-label="`历史${field.label}${revealed.includes(field.key) ? '隐藏' : '显示'}`" @click="revealed = revealed.includes(field.key) ? revealed.filter((key) => key !== field.key) : [...revealed, field.key]">{{ revealed.includes(field.key) ? '隐藏' : '显示' }}</n-button>
          </div>
          <div class="history-values">
            <div><n-text depth="3">历史版本</n-text><pre>{{ field.hidden && field.before !== undefined && !revealed.includes(field.key) ? '••••••••' : formatValue(field.key, field.before) }}</pre></div>
            <div><n-text depth="3">当前内容</n-text><pre>{{ field.hidden && field.after !== undefined && !revealed.includes(field.key) ? '••••••••' : formatValue(field.key, field.after) }}</pre></div>
          </div>
        </div>
        <n-button v-if="canRestore" type="primary" :loading="busy" @click="restore">恢复此版本</n-button>
        <n-text v-else depth="3">请先将凭证移出回收站，再恢复历史内容。</n-text>
      </template>
    </div>
  </section>
</template>

<style scoped>
.history-content { display: flex; flex-direction: column; gap: 12px; margin-top: 16px; }
.history-field { padding: 12px 0; border-top: 1px solid rgba(128, 128, 128, .16); }
.history-field-heading { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; overflow-wrap: anywhere; }
.history-field-heading > .n-button { margin-left: auto; }
.history-values { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 16px; margin-top: 8px; }
.history-values pre { margin: 4px 0 0; white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; }
</style>
