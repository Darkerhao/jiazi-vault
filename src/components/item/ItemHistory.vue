<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { NAlert, NButton, NSelect, NText, useDialog, useMessage } from 'naive-ui'
import { callCommand } from '../../services/ipc'
import { useAuthStore } from '../../stores/auth'
import { useVaultStore } from '../../stores/vault'
import { TYPE_FIELDS } from '../../utils/item-fields'
import type { ItemHistorySummary, VaultItem } from '../../../electron/contracts'

const props = defineProps<{ itemId: string; canRestore: boolean }>()
const emit = defineEmits<{ restored: [] }>()
const auth = useAuthStore(), vault = useVaultStore(), dialog = useDialog(), message = useMessage()
const open = ref(false), busy = ref(false), error = ref('')
const versions = ref<ItemHistorySummary[]>([]), selected = ref<number | null>(null)
const preview = ref<VaultItem | null>(null), revealed = ref<string[]>([])
let disposed = false, request = 0
let dismiss: (() => void) | undefined
const fields = computed(() => {
  const item = preview.value
  if (!item) return []
  const result = ['username', 'password', 'url', 'host', 'port', 'notes'].flatMap((key) => {
    const value = item[key as keyof VaultItem]
    return value === undefined ? [] : [{ key, label: ({ username: '用户名', password: '密码', url: 'URL', host: '主机', port: '端口', notes: '备注' } as Record<string, string>)[key], value: String(value) }]
  })
  for (const [key, value] of Object.entries(item.fields ?? {})) result.push({ key: `field:${key}`, label: TYPE_FIELDS[item.type].find((field) => field.target === 'field' && field.key === key)?.label ?? key, value })
  return result
})
async function load() {
  open.value = true
  busy.value = true
  error.value = ''
  const current = ++request, revision = auth.sessionRevision
  try {
    const result = await callCommand('list_item_history', { id: props.itemId })
    if (!disposed && current === request && revision === auth.sessionRevision) versions.value = result
  } catch { if (!disposed && revision === auth.sessionRevision) error.value = '历史版本读取失败，请重试。' }
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
    const item = await callCommand('get_item_history', { id: props.itemId, historyId: id })
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
        await callCommand('restore_item_history', { id: props.itemId, historyId })
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
    <n-button :loading="busy" @click="open ? (open = false, preview = null, selected = null, request++) : load()">{{ open ? '收起历史版本' : '历史版本' }}</n-button>
    <div v-if="open" class="history-content">
      <n-text depth="3">保留最近 20 次修改前的完整内容，历史版本均加密保存。永久删除凭证会一并删除历史。</n-text>
      <n-alert v-if="error" type="error">{{ error }} <n-button text @click="selected ? select(selected) : load()">重试</n-button></n-alert>
      <n-text v-if="!busy && !versions.length && !error" depth="3">暂无历史版本，下次修改保存后会自动保留。</n-text>
      <n-select v-if="versions.length" :value="selected" :options="versions.map((version, index) => ({ value: version.id, label: `${new Date(version.savedAt).toLocaleString()} · 修改前版本 ${versions.length - index}` }))" placeholder="选择历史版本" aria-label="选择历史版本" :disabled="busy" @update:value="select" />
      <template v-if="preview">
        <n-text strong>历史名称：{{ preview.title }}</n-text>
        <n-text depth="3">项目：{{ vault.projects.find((project) => project.id === preview?.projectId)?.name || (preview.projectId ? '原项目已删除' : '未分配项目') }} · 环境：{{ preview.environment || '未设置' }} · 标签：{{ preview.tags?.join('、') || '无' }}</n-text>
        <div v-for="field in fields" :key="field.key" class="history-field">
          <n-text depth="3">{{ field.label }}</n-text>
          <pre>{{ revealed.includes(field.key) ? field.value || '（空值）' : '••••••••' }}</pre>
          <n-button size="small" :aria-label="`历史${field.label}${revealed.includes(field.key) ? '隐藏' : '显示'}`" @click="revealed = revealed.includes(field.key) ? revealed.filter((key) => key !== field.key) : [...revealed, field.key]">{{ revealed.includes(field.key) ? '隐藏' : '显示' }}</n-button>
        </div>
        <n-button v-if="canRestore" type="primary" :loading="busy" @click="restore">恢复此版本</n-button>
        <n-text v-else depth="3">请先将凭证移出回收站，再恢复历史内容。</n-text>
      </template>
    </div>
  </section>
</template>

<style scoped>
.history-content { display: flex; flex-direction: column; gap: 12px; margin-top: 16px; }
.history-field { display: flex; align-items: flex-start; gap: 12px; }
.history-field > .n-text { min-width: 70px; }
.history-field pre { flex: 1; min-width: 0; margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; }
</style>
