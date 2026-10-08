<script setup lang="ts">
import { computed, ref } from 'vue'
import { NAlert, NButton, NFormItem, NModal, NSelect, NSpace, useMessage } from 'naive-ui'
import { useVaultStore } from '../../stores/vault'
import { callCommand } from '../../services/ipc'
import type { ExportScope, TransferFormat } from '../../../electron/contracts'

const props = defineProps<{ ids?: string[]; disabled?: boolean }>()
const vault = useVaultStore(), message = useMessage()
const show = ref(false), busy = ref(false)
const format = ref<TransferFormat>('json')
const project = ref<string | null>(null)
const selected = ref<string[] | null>(null)
const scope = computed<ExportScope>(() => selected.value ? { kind: 'items', ids: [...selected.value] } : project.value ? { kind: 'project', projectId: project.value } : { kind: 'all' })
const count = computed(() => vault.items.filter((item) => selected.value ? selected.value.includes(item.id) : !project.value || item.projectId === project.value).length)
async function open() {
  selected.value = props.ids ? [...props.ids] : null
  project.value = null
  show.value = true
  await vault.load()
}
async function exportFile() {
  if (busy.value || !count.value) return
  busy.value = true
  try {
    const name = await callCommand('export_plaintext', { format: format.value, scope: scope.value })
    if (name) { message.success(`明文文件已保存：${name}`); show.value = false }
  } catch { message.error('导出失败，请检查凭证是否仍然存在、目标位置权限，或重新解锁后重试。') }
  finally { busy.value = false }
}
</script>

<template>
  <n-button :disabled="disabled || (ids !== undefined && !ids.length)" @click="open">{{ ids ? '导出所选' : '导出 JSON / CSV' }}</n-button>
  <n-modal v-model:show="show" preset="card" title="导出凭证" style="width: 520px; max-width: calc(100vw - 40px)" :closable="!busy" :mask-closable="!busy" :close-on-esc="!busy">
    <n-alert type="warning">导出文件包含明文密码和私钥，请妥善保管。</n-alert>
    <n-alert v-if="vault.error" type="error">{{ vault.error }} <n-button text :disabled="busy" @click="vault.load">重试</n-button></n-alert>
    <n-form-item v-if="!selected" label="导出范围" class="export-scope"><n-select v-model:value="project" :disabled="busy" clearable filterable placeholder="全部有效凭证" :options="vault.projects.map((item) => ({ label: item.name, value: item.id }))" aria-label="导出项目" /></n-form-item>
    <p>{{ selected ? '所选凭证' : project ? `项目：${vault.projects.find((item) => item.id === project)?.name}` : '全部有效凭证' }} · 共 {{ count }} 条（不含回收站）</p>
    <n-form-item label="文件格式"><n-select v-model:value="format" :disabled="busy" :options="[{ label: 'JSON', value: 'json' }, { label: 'CSV', value: 'csv' }]" /></n-form-item>
    <n-space justify="end"><n-button :disabled="busy" @click="show = false">取消</n-button><n-button type="primary" :disabled="!count || !!vault.error" :loading="busy" @click="exportFile">确认导出 {{ count }} 条</n-button></n-space>
  </n-modal>
</template>

<style scoped>
.export-scope { margin-top: 20px; }
</style>
