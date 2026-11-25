<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { NAlert, NButton, NCard, NCheckbox, NFormItem, NModal, NPagination, NSelect, NSpace, NText, useMessage } from 'naive-ui'
import { callCommand } from '../../services/ipc'
import { useVaultStore } from '../../stores/vault'
import { useAuthStore } from '../../stores/auth'
import type { ImportColumns, ImportMapping, ImportPreview } from '../../types/contracts'
import { ITEM_TYPE_LABELS, ITEM_TYPE_OPTIONS } from '../../utils/item-fields'
import type { ItemType } from '../../types/vault'
import PlaintextExport from './PlaintextExport.vue'

const busy = ref(false)
const message = useMessage()
const vault = useVaultStore()
const auth = useAuthStore()
const preview = ref<ImportPreview | null>(null)
const source = ref<ImportColumns | null>(null)
const mapping = ref<ImportMapping>({ columns: {}, defaultType: 'login' })
const mappingError = ref('')
const mappingFields = [{ key: 'title', label: '名称' }, { key: 'username', label: '账号' }, { key: 'password', label: '密码' }, { key: 'url', label: '网址' }, { key: 'type', label: '类型' }] as const
const skipDuplicates = ref(true)
const page = ref(1)
const selectedCount = computed(() => preview.value ? preview.value.validCount - (skipDuplicates.value ? preview.value.duplicateCount : 0) : 0)
const previewRows = computed(() => preview.value?.rows.slice((page.value - 1) * 50, page.value * 50) ?? [])
let disposed = false
function closePreview() {
  const token = preview.value?.token ?? source.value?.token
  preview.value = null
  source.value = null
  mappingError.value = ''
  if (token && auth.unlocked) void callCommand('cancel_import', { token }).catch(() => {})
}
onBeforeUnmount(() => { disposed = true; closePreview() })

async function importFile() {
  if (busy.value) return
  busy.value = true
  const revision = auth.sessionRevision
  try {
    const result = await callCommand('preview_import')
    if (disposed || revision !== auth.sessionRevision) {
      if (result && auth.unlocked) void callCommand('cancel_import', { token: result.token }).catch(() => {})
      return
    }
    if (result && 'columns' in result) {
      source.value = result
      mapping.value = { columns: {}, defaultType: 'login' }
      for (const field of mappingFields) {
        const index = result.columns.indexOf(field.key)
        if (index >= 0) mapping.value.columns[field.key] = index
      }
    } else preview.value = result
    page.value = 1
    skipDuplicates.value = true
  } catch {
    if (!disposed && revision === auth.sessionRevision) message.error('无法预览文件。请检查 JSON/CSV 语法、表头、文件权限及 64 MiB 容量限制。')
  } finally { busy.value = false }
}

async function mapColumns() {
  if (!source.value || busy.value) return
  if (mapping.value.columns.title === undefined) { mappingError.value = '请选择名称列。'; return }
  const indices = Object.values(mapping.value.columns)
  if (new Set(indices).size !== indices.length) { mappingError.value = '同一列只能映射到一个字段。'; return }
  busy.value = true
  mappingError.value = ''
  const revision = auth.sessionRevision
  try {
    const result = await callCommand('map_import', { token: source.value.token, mapping: { columns: { ...mapping.value.columns }, defaultType: mapping.value.defaultType } })
    if (!disposed && revision === auth.sessionRevision) { preview.value = result; page.value = 1 }
  } catch {
    if (!disposed && revision === auth.sessionRevision) mappingError.value = '列映射未完成，请检查所选列和类型后重试。'
  } finally { busy.value = false }
}

async function confirmImport() {
  if (!preview.value || busy.value) return
  busy.value = true
  const revision = auth.sessionRevision
  try {
    const count = await callCommand('confirm_import', { token: preview.value.token, skipDuplicates: skipDuplicates.value })
    if (disposed || revision !== auth.sessionRevision) return
    preview.value = null
    source.value = null
    await vault.load(true)
    message.success(`已导入 ${count} 条凭证`)
  } catch {
    if (!disposed && revision === auth.sessionRevision) {
      closePreview()
      message.error('导入失败，未新增凭证。请重新选择文件预览后重试。')
    }
  } finally { busy.value = false }
}
</script>

<template>
  <n-card title="JSON / CSV 导入导出" class="transfer-card" bordered>
    <n-alert type="warning" :show-icon="false">导出文件包含明文密码和私钥。导出前需要再次确认，请妥善保管文件。</n-alert>
    <p><n-text depth="3">导出有效凭证及项目名称，不含回收站。导入前可预览记录、检查格式错误，并选择跳过完全重复的凭证。</n-text></p>
    <details>
      <summary>导入格式说明</summary>
      <p>JSON 为本应用对象数组。CSV 首行为表头；本应用格式自动识别，其他文件可映射名称、账号、密码和网址，并选择统一凭证类型。未映射的列不导入。项目使用 project 名称；tags 为 JSON 数组，fields 为 JSON 对象。</p>
      <p>示例：<code>[{"type":"login","title":"示例账号","username":"user","password":"secret"}]</code></p>
      <p>CSV 中以公式符号或单引号开头的文本使用单引号转义，重新导入时还原。建议使用 JSON 保留完整文本。完整加密备份请使用上方备份功能。</p>
    </details>
    <n-space class="transfer-actions">
      <n-button :disabled="busy" @click="importFile">导入 JSON / CSV</n-button>
      <PlaintextExport :disabled="busy" />
      <n-text v-if="busy" depth="3">正在处理…</n-text>
    </n-space>
  </n-card>
  <n-modal :show="!!preview || !!source" preset="card" :title="preview ? '导入预览' : 'CSV 列映射'" style="width: 760px; max-width: calc(100vw - 40px)" :content-style="{ maxHeight: 'calc(100dvh - 220px)', overflowY: 'auto' }" :closable="!busy" :mask-closable="!busy" :close-on-esc="!busy" @update:show="(show) => !show && closePreview()">
    <template v-if="source && !preview">
      <p>{{ source.name }} · {{ source.rowCount }} 条记录</p>
      <p>将 CSV 列对应到凭证字段。此处仅显示表头；未映射的列不导入。</p>
      <n-form-item v-for="field in mappingFields" :key="field.key" :label="field.label" :required="field.key === 'title'">
        <n-select filterable :value="mapping.columns[field.key] ?? null" :disabled="busy" clearable :input-props="{ 'aria-label': `映射${field.label}列` }" :options="source.columns.map((label, value) => ({ label: `${value + 1}. ${label || '未命名列'}`, value }))" placeholder="不导入此字段" @update:value="(value) => { if (value === null) delete mapping.columns[field.key]; else mapping.columns[field.key] = value }" />
      </n-form-item>
      <n-form-item :label="mapping.columns.type === undefined ? '统一凭证类型' : '类型为空时使用'">
        <n-select filterable v-model:value="mapping.defaultType" :disabled="busy" :options="ITEM_TYPE_OPTIONS.filter(option => option.value !== 'env')" :input-props="{ 'aria-label': '统一凭证类型' }" />
      </n-form-item>
      <n-text v-if="mapping.columns.type !== undefined" depth="3">类型列需使用 login、password、server、database、api-key、ssh、secure-note 或 custom。</n-text>
      <n-alert v-if="mappingError" type="error">{{ mappingError }}</n-alert>
    </template>
    <template v-if="preview">
      <p>{{ preview.name }} · 有效 {{ preview.validCount }} 条 · 重复 {{ preview.duplicateCount }} 条 · 错误 {{ preview.invalidCount }} 条</p>
      <n-checkbox v-model:checked="skipDuplicates" :disabled="busy">跳过完全重复的记录</n-checkbox>
      <p><n-text depth="3">与当前有效凭证或文件内前面的记录比较内容，忽略收藏、置顶和时间。同名但内容不同会新增；现有凭证不会被覆盖。预览不显示密码。记录号从 1 开始，CSV 不含表头。</n-text></p>
      <n-alert v-if="preview.invalidCount" type="warning">无效记录将跳过；请按记录号修正源文件后重新导入。</n-alert>
      <table class="preview-table"><thead><tr><th>记录</th><th>名称 / 类型</th><th>检查结果</th></tr></thead><tbody><tr v-for="row in previewRows" :key="row.row"><td>{{ row.row }}</td><td>{{ row.title }}<div>{{ ITEM_TYPE_LABELS[row.type as ItemType] || '—' }}</div></td><td>{{ row.error || (row.duplicate ? '内容完全重复' : '可导入') }}</td></tr></tbody></table>
      <n-pagination v-if="preview.rows.length > 50" v-model:page="page" :page-size="50" :item-count="preview.rows.length" />
    </template>
    <template #footer><n-space justify="end"><n-button :disabled="busy" @click="closePreview">取消导入</n-button><n-button v-if="source && preview" :disabled="busy" @click="preview = null">调整列映射</n-button><n-button v-if="!preview" type="primary" :loading="busy" @click="mapColumns">预览导入</n-button><n-button v-else type="primary" :disabled="!selectedCount" :loading="busy" @click="confirmImport">导入 {{ selectedCount }} 条有效记录</n-button></n-space></template>
  </n-modal>
</template>

<style scoped>
.preview-table { width: 100%; border-collapse: collapse; table-layout: fixed; margin: 16px 0; }
.preview-table th, .preview-table td { text-align: left; padding: 10px 8px; border-bottom: 1px solid #8884; overflow-wrap: anywhere; }
.preview-table th:first-child { width: 60px; }
.transfer-actions { margin-top: 20px; }
summary { cursor: pointer; }
code { overflow-wrap: anywhere; }
</style>
