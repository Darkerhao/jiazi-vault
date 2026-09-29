<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router'
import { NAlert, NButton, NForm, NFormItem, NInput, NModal, NSelect, NSpace, NText, useDialog, useMessage } from 'naive-ui'
import { useVaultStore } from '../../stores/vault'
import { useClipboard } from '../../composables/useClipboard'
import { ENVIRONMENT_OPTIONS, ITEM_TYPE_OPTIONS, TYPE_FIELDS, type FieldDef } from '../../utils/item-fields'
import type { Environment, ItemInput, ItemType, VaultItem } from '../../types/vault'
import { ENV_NAME, serializeEnv } from '../../../electron/env'
import { callCommand } from '../../services/ipc'
import { useAuthStore } from '../../stores/auth'
import EnvImport from './EnvImport.vue'
import PasswordGenerator from '../common/PasswordGenerator.vue'
import { projectService } from '../../services/project'
import { validExpiry, expiryState } from '../../../electron/expiry'

const props = defineProps<{ show: boolean; item: VaultItem | null; draft?: { type?: ItemType; password?: string; projectId?: string; environment?: Environment } }>()
const emit = defineEmits<{ (event: 'close'): void }>()

const vault = useVaultStore()
const message = useMessage()
const dialog = useDialog()
const { copy } = useClipboard()
const auth = useAuthStore()
const importing = ref(false), exporting = ref(false)
const generating = ref(false)
const creatingProject = ref(false)
const projectName = ref('')
const projectError = ref('')
const projectSaving = ref(false)

async function createProject() {
  if (!projectName.value.trim() || projectSaving.value) return
  projectSaving.value = true
  projectError.value = ''
  const revision = auth.sessionRevision
  try {
    const project = await projectService.create({ name: projectName.value.trim(), icon: '📁', color: '#c7ef68' })
    if (disposed || revision !== auth.sessionRevision) return
    vault.projects = [...vault.projects, project]
    projectId.value = project.id
    creatingProject.value = false
    projectName.value = ''
    void vault.load()
  } catch (error) {
    if (!disposed && revision === auth.sessionRevision) projectError.value = error instanceof Error && error.message.includes('PROJECT_NAME_EXISTS') ? '项目名称已存在，请选择已有项目或更换名称。' : '创建失败，请重试。'
  } finally { projectSaving.value = false }
}
let disposed = false
onBeforeUnmount(() => {
  disposed = true
  dismissDiscard?.()
  initialSnapshot.value = ''
  extraFields.value = []
  for (const key of Object.keys(values)) delete values[key]
})

const type = ref<ItemType>('login')
const title = ref('')
const environment = ref<Environment | null>(null)
const projectId = ref<string | null>(null)
const saving = ref(false)
const projectOptions = computed(() => vault.projects.map((p) => ({ label: p.name, value: p.id })))
const tags = ref('')
const values = reactive<Record<string, string | null>>({})
const revealedFields = reactive(new Set<string>())
const extraFields = ref<{ id: number; name: string; value: string; visible: boolean }[]>([])
let nextFieldId = 0
const initialSnapshot = ref('')
let discardDecision: Promise<boolean> | null = null
let dismissDiscard: (() => void) | undefined

function snapshot() {
  return JSON.stringify({ type: type.value, title: title.value, environment: environment.value, projectId: projectId.value,
    tags: tags.value, values, fields: extraFields.value.map(({ name, value }) => ({ name, value })), importing: importing.value,
    projectName: creatingProject.value ? projectName.value : '' })
}

function confirmDiscard(changed = snapshot() !== initialSnapshot.value): Promise<boolean> {
  if (!auth.unlocked || viewing.value) return Promise.resolve(true)
  if (saving.value || exporting.value || projectSaving.value) return Promise.resolve(false)
  if (!changed) return Promise.resolve(true)
  if (discardDecision) return discardDecision
  discardDecision = new Promise<boolean>((resolve) => {
    const prompt = dialog.warning({
      title: '放弃未保存的修改？', content: '继续操作将丢弃未保存的内容。',
      positiveText: '放弃修改', negativeText: '继续编辑',
      onPositiveClick: () => resolve(true), onAfterLeave: () => resolve(false),
    })
    dismissDiscard = () => { prompt.destroy(); resolve(false) }
  }).finally(() => { discardDecision = null; dismissDiscard = undefined })
  return discardDecision
}

async function requestClose() {
  if (await confirmDiscard() && !disposed) emit('close')
}

onBeforeRouteLeave(() => confirmDiscard())
onBeforeRouteUpdate((to, from) => {
  if ((to.query.new && to.query.new !== from.query.new) || (to.query.item && to.query.item !== from.query.item)) return confirmDiscard()
  return true
})

const viewing = ref(props.item !== null)
const isEdit = computed(() => props.item !== null)
const isEnv = computed(() => type.value === 'env')
const fields = computed<FieldDef[]>(() => {
  const result = [...TYPE_FIELDS[type.value]]
  // Imported credentials may contain common fields outside their type's template.
  for (const field of [...TYPE_FIELDS.password, ...TYPE_FIELDS.server]) {
    if (field.target === 'field' || props.item?.[field.target] === undefined) continue
    if (!result.some((entry) => entry.target === field.target)) result.push(field)
  }
  return result
})
const fieldError = computed(() => {
  if (isEnv.value && !extraFields.value.length) return '请新增变量或导入 .env 文件。'
  const names = new Set(fields.value.filter((field) => field.target === 'field').map((field) => field.key))
  for (const field of extraFields.value) {
    const name = field.name.trim()
    if (!name) return '请输入字段名称，或删除未使用的字段。'
    if (isEnv.value && !ENV_NAME.test(name)) return '变量名只能包含字母、数字和下划线，且不能以数字开头。'
    if (names.has(name)) return '字段名称不能重复，也不能与当前类型的内置字段重名。'
    names.add(name)
  }
  return ''
})
const envFields = computed(() => Object.fromEntries(extraFields.value.map(({ name, value }) => [name.trim(), value])))
const exportError = computed(() => {
  if (!isEnv.value || fieldError.value) return ''
  try { serializeEnv(envFields.value); return '' }
  catch (error) { return (error as Error).message }
})
const portError = computed(() => {
  const port = values.port
  return port && (!/^\d+$/.test(port) || Number(port) > 65535) ? '端口需为 0–65535 的整数。' : ''
})
const expiryError = computed(() => type.value === 'api-key' && values.expiresAt && !validExpiry(values.expiresAt) ? '请选择有效日期（YYYY-MM-DD），旧日期需重新选择。' : '')
const invalid = computed(() => !!expiryError.value || !!portError.value || !title.value.trim() || !!fieldError.value || (isEnv.value && (!environment.value || importing.value)))

function applyEnv(fields: Record<string, string>) {
  extraFields.value.push(...Object.entries(fields).map(([name, value]) => ({ id: nextFieldId++, name, value, visible: false })))
  importing.value = false
}

async function exportEnv(destination: 'clipboard' | 'file') {
  if (fieldError.value || exportError.value || importing.value || exporting.value) return
  exporting.value = true
  const revision = auth.sessionRevision
  try {
    const result = await callCommand('export_env', { fields: envFields.value, destination, itemId: props.item?.id })
    if (disposed || revision !== auth.sessionRevision || !result) return
    if (props.item && result.usedAt !== null) vault.applyUsage(props.item.id, result.usedAt)
    message.success(destination === 'clipboard' ? '已复制完整 .env 内容' : `已导出 ${result.name}`)
  } catch {
    if (!disposed && revision === auth.sessionRevision) message.error('导出失败，请确认保险库已解锁且目标文件可写。')
  } finally { exporting.value = false }
}

watch(
  () => props.show,
  (show) => {
    if (!show) return
    const item = props.item
    if (item) {
      type.value = item.type
      title.value = item.title
      environment.value = item.environment ?? null
      projectId.value = item.projectId ?? null
      tags.value = item.tags?.join(', ') ?? ''
    } else {
      type.value = props.draft?.type ?? 'login'
      title.value = ''
      environment.value = props.draft?.environment ?? null
      projectId.value = props.draft?.projectId ?? null
      tags.value = ''
    }
    resetValues(item)
    if (!item && props.draft?.password) values.password = props.draft.password
    initialSnapshot.value = snapshot()
  },
  { immediate: true },
)

function resetValues(item: VaultItem | null) {
  revealedFields.clear()
  for (const key of Object.keys(values)) delete values[key]
  for (const field of fields.value) {
    values[field.key] = readField(item, field)
    if (!item && field.sensitive) revealedFields.add(field.key)
  }
  const known = new Set(fields.value.filter((field) => field.target === 'field').map((field) => field.key))
  extraFields.value = Object.entries(item?.fields ?? {}).filter(([name]) => !known.has(name))
    .map(([name, value]) => ({ id: nextFieldId++, name, value, visible: false }))
}

function readField(item: VaultItem | null, field: FieldDef): string | null {
  if (!item) return null
  if (field.target === 'field') return item.fields?.[field.key] ?? null
  if (field.target === 'port') return item.port != null ? String(item.port) : null
  return item[field.target] ?? null
}

async function onTypeChange(value: ItemType) {
  const hasValues = Object.values(values).some(Boolean) || extraFields.value.length > 0 || importing.value
  if (!await confirmDiscard(hasValues) || disposed) return
  importing.value = false
  generating.value = false
  type.value = value
  resetValues(null)
}

function buildItem(): ItemInput {
  const item: ItemInput = {
    type: type.value,
    title: title.value.trim(),
    favorite: props.item?.favorite ?? false,
  }
  if (environment.value) item.environment = environment.value
  if (projectId.value) item.projectId = projectId.value
  const parsedTags = Array.from(new Set(tags.value.split(/[,，\s]+/).map((s) => s.trim()).filter(Boolean)))
  if (parsedTags.length) item.tags = parsedTags
  for (const field of fields.value) {
    const value = values[field.key]
    if (!value) continue
    if (field.target === 'port') { item.port = Number(value); continue }
    if (field.target === 'notes') { item.notes = value; continue }
    if (field.target === 'field') { item.fields ??= Object.create(null) as Record<string, string>; item.fields[field.key] = value; continue }
    item[field.target] = value
  }
  for (const field of extraFields.value) {
    item.fields ??= Object.create(null) as Record<string, string>
    item.fields[field.name.trim()] = field.value
  }
  return item
}

async function save() {
  if (invalid.value || saving.value || projectSaving.value || creatingProject.value) return
  saving.value = true
  const input = buildItem()
  const ok = props.item ? await vault.updateItem({ ...input, id: props.item.id, createdAt: props.item.createdAt, updatedAt: props.item.updatedAt }) : await vault.createItem(input)
  saving.value = false
  if (disposed) return
  if (!ok) {
    message.error('保存失败，请重试')
    return
  }
  emit('close')
}
</script>

<template>
  <n-modal
    :show="show"
    preset="card"
    :title="viewing ? '凭证详情' : isEnv ? (isEdit ? '编辑环境变量集' : '新建环境变量集') : (isEdit ? '编辑凭证' : '新建凭证')"
    style="width: 720px; max-width: calc(100vw - 40px)"
    :bordered="false"
    :closable="!saving && !exporting"
    :mask-closable="!saving && !exporting"
    :close-on-esc="!saving && !exporting"
    :content-style="{ maxHeight: 'calc(100dvh - 200px)', overflowY: 'auto' }"
    @update:show="(v) => !v && requestClose()"
  >
    <section v-if="viewing" class="item-detail">
      <h2>{{ title }}</h2>
      <n-text depth="3">{{ ITEM_TYPE_OPTIONS.find((option) => option.value === type)?.label }} · {{ vault.projects.find((project) => project.id === projectId)?.name || '未分配项目' }}<span v-if="environment"> · {{ ENVIRONMENT_OPTIONS.find((option) => option.value === environment)?.label }}</span></n-text>
      <n-alert v-if="type === 'api-key' && ['expired', 'soon', 'invalid'].includes(expiryState(values.expiresAt ?? undefined))" :type="expiryState(values.expiresAt ?? undefined) === 'expired' ? 'error' : 'warning'">{{ expiryState(values.expiresAt ?? undefined) === 'expired' ? '此 API Key 已过期，请向服务商确认并更新凭证。' : expiryState(values.expiresAt ?? undefined) === 'invalid' ? '过期日期格式待修正，请编辑凭证重新选择日期。' : '此 API Key 将在 7 天内到期（所选日期当天有效）。' }}</n-alert>
      <div v-for="field in fields.filter((field) => values[field.key])" :key="field.key" class="detail-field">
        <n-text depth="3">{{ field.label }}</n-text>
        <div class="field-value">
          <pre>{{ (field.sensitive || field.kind === 'password' || field.target === 'notes') && !revealedFields.has(field.key) ? '••••••••' : values[field.key] }}</pre>
          <n-button v-if="field.sensitive || field.kind === 'password' || field.target === 'notes'" size="small" :aria-label="`${revealedFields.has(field.key) ? '隐藏' : '显示'}${field.label}`" @click="revealedFields.has(field.key) ? revealedFields.delete(field.key) : revealedFields.add(field.key)">{{ revealedFields.has(field.key) ? '隐藏' : '显示' }}</n-button>
          <n-button size="small" :aria-label="`复制${field.label}`" @click="copy(values[field.key] ?? '', item?.id)">复制</n-button>
        </div>
      </div>
      <div v-for="field in extraFields" :key="field.id" class="detail-field">
        <n-text depth="3">{{ field.name }}</n-text>
        <div class="field-value"><pre>{{ field.visible ? field.value || '（空值）' : '••••••••' }}</pre><n-button size="small" :aria-label="`${field.visible ? '隐藏' : '显示'}${field.name}`" @click="field.visible = !field.visible">{{ field.visible ? '隐藏' : '显示' }}</n-button><n-button size="small" :aria-label="`复制${field.name}`" @click="copy(field.value, item?.id)">复制</n-button></div>
      </div>
      <n-space v-if="isEnv"><n-button :disabled="!!exportError" :loading="exporting" @click="exportEnv('clipboard')">复制完整 .env</n-button><n-button :disabled="!!exportError" :loading="exporting" @click="exportEnv('file')">导出 .env 文件</n-button></n-space>
      <n-text v-if="tags" depth="3">标签：{{ tags }}</n-text>
    </section>
    <n-form v-else label-placement="left" label-width="96" :disabled="saving || exporting">
      <n-form-item label="类型">
        <n-select :value="type" :options="ITEM_TYPE_OPTIONS" :disabled="isEdit" @update:value="onTypeChange" />
      </n-form-item>
      <n-form-item label="名称" required>
        <n-input v-model:value="title" :placeholder="isEnv ? '变量集名称' : '凭证名称'" />
      </n-form-item>
      <n-form-item label="项目">
        <div class="custom-fields">
          <div class="field-value">
            <n-select v-model:value="projectId" :options="projectOptions" clearable filterable placeholder="选择项目（可选）" />
            <n-button v-if="!creatingProject" @click="creatingProject = true; projectError = ''">新建项目</n-button>
          </div>
          <template v-if="creatingProject">
            <div class="field-value">
              <n-input v-model:value="projectName" placeholder="新项目名称" :maxlength="80" :disabled="projectSaving" @keydown.enter.prevent="createProject" />
              <n-button :loading="projectSaving" :disabled="!projectName.trim()" @click="createProject">创建并选中</n-button>
              <n-button :disabled="projectSaving" @click="creatingProject = false; projectName = ''; projectError = ''">取消创建</n-button>
            </div>
            <n-alert v-if="projectError" type="error">{{ projectError }}</n-alert>
          </template>
        </div>
      </n-form-item>
      <n-form-item label="环境" :required="isEnv">
        <n-select v-model:value="environment" :options="ENVIRONMENT_OPTIONS" clearable placeholder="选择环境" />
      </n-form-item>
      <n-form-item v-for="field in fields" :key="field.key" :label="field.label" :validation-status="(field.target === 'port' && portError) || (field.key === 'expiresAt' && expiryError) ? 'error' : undefined" :feedback="field.target === 'port' ? portError : field.key === 'expiresAt' ? expiryError : undefined">
        <div class="field-value">
          <input v-if="field.key === 'expiresAt'" v-model="values[field.key]" type="date" class="expiry-input" aria-label="过期时间" />
          <n-input v-else-if="!field.sensitive || revealedFields.has(field.key)" v-model:value="values[field.key]" :type="field.kind" show-password-on="click" :autosize="field.kind === 'textarea' ? { minRows: 3, maxRows: 8 } : false" :placeholder="field.label" />
          <n-input v-else :value="values[field.key] ? '••••••••' : ''" readonly :placeholder="field.label" />
          <n-button v-if="field.sensitive" :aria-label="`${revealedFields.has(field.key) ? '隐藏' : '显示'}${field.label}`" @click="revealedFields.has(field.key) ? revealedFields.delete(field.key) : revealedFields.add(field.key)">{{ revealedFields.has(field.key) ? '隐藏' : '显示' }}</n-button>
          <n-button :disabled="!values[field.key]" :aria-label="`复制${field.label}`" @click="copy(values[field.key] ?? '', item?.id)">复制</n-button>
          <n-button v-if="field.target === 'password'" @click="generating = !generating">{{ generating ? '收起生成器' : '生成密码' }}</n-button>
        </div>
      </n-form-item>
      <n-form-item v-if="generating" label="密码生成器">
        <PasswordGenerator v-slot="{ password, busy }">
          <n-button type="primary" :disabled="!password || busy" @click="values.password = password ?? null; generating = false">填入密码</n-button>
          <n-button @click="generating = false">取消生成</n-button>
        </PasswordGenerator>
      </n-form-item>
      <n-form-item v-if="isEnv" label=".env 文件">
        <div class="custom-fields">
          <n-alert type="info" :show-icon="false">采用 Node.js DotEnv 语法：支持空值、单双引号、注释、引号内多行和 export 前缀；双引号内的 \n 解析为换行。不展开变量引用，不执行命令。导出保留值，不保留注释和排版。</n-alert>
          <EnvImport v-if="importing" :names="extraFields.map((field) => field.name.trim())" @apply="applyEnv" @cancel="importing = false" />
          <n-button v-else dashed @click="importing = true">导入 .env</n-button>
          <n-space>
            <n-button :disabled="!!fieldError || !!exportError || importing" :loading="exporting" @click="exportEnv('clipboard')">复制完整 .env</n-button>
            <n-button :disabled="!!fieldError || !!exportError || importing" :loading="exporting" @click="exportEnv('file')">导出 .env 文件</n-button>
          </n-space>
          <n-alert v-if="exportError" type="warning" :show-icon="false">{{ exportError }}</n-alert>
        </div>
      </n-form-item>
      <n-form-item :label="isEnv ? '环境变量' : '自定义字段'">
        <div class="custom-fields">
          <div v-for="field in extraFields" :key="field.id" class="custom-field">
            <div class="field-value">
              <n-input v-model:value="field.name" :placeholder="isEnv ? '变量名称' : '字段名称'" :input-props="{ 'aria-label': isEnv ? '变量名称' : '字段名称' }" />
              <n-button :aria-label="`删除字段${field.name}`" @click="extraFields = extraFields.filter((entry) => entry.id !== field.id)">删除</n-button>
            </div>
            <div class="field-value">
              <n-input v-if="field.visible" v-model:value="field.value" type="textarea" :autosize="{ minRows: 2, maxRows: 6 }" :placeholder="field.name || '字段值'" :input-props="{ 'aria-label': `字段值${field.name}` }" />
              <n-input v-else :value="field.value ? '••••••••' : ''" readonly placeholder="空值" :input-props="{ 'aria-label': `字段值${field.name}` }" />
              <n-button :aria-label="`${field.visible ? '隐藏' : '显示'}${field.name}`" @click="field.visible = !field.visible">{{ field.visible ? '隐藏' : '显示' }}</n-button>
              <n-button :disabled="!isEnv && !field.value" :aria-label="`复制${field.name || '字段值'}`" @click="copy(field.value, item?.id)">复制</n-button>
            </div>
          </div>
          <n-alert v-if="fieldError" type="warning" :show-icon="false">{{ fieldError }}</n-alert>
          <n-button dashed @click="extraFields.push({ id: nextFieldId++, name: '', value: '', visible: true })">{{ isEnv ? '新增变量' : '新增字段' }}</n-button>
        </div>
      </n-form-item>
      <n-form-item label="标签">
        <n-input v-model:value="tags" placeholder="逗号分隔，如 production, api" />
      </n-form-item>
    </n-form>
    <template #footer>
      <n-space justify="end">
        <n-button :disabled="saving || exporting" @click="requestClose">{{ viewing ? '关闭' : '取消' }}</n-button>
        <n-button v-if="viewing && !item?.deletedAt" type="primary" @click="viewing = false">编辑凭证</n-button>
        <n-button v-if="!viewing" type="primary" :loading="saving" :disabled="invalid || exporting || creatingProject" @click="save">保存</n-button>
      </n-space>
    </template>
  </n-modal>
</template>

<style scoped>
.expiry-input { flex: 1; min-width: 0; height: 34px; padding: 0 10px; border: 1px solid var(--n-border-color); border-radius: 10px; color: inherit; background: transparent; font: inherit; color-scheme: light dark; }
.item-detail { display: flex; flex-direction: column; gap: 20px; }
.item-detail h2 { margin: 0; overflow-wrap: anywhere; }
.detail-field { display: flex; flex-direction: column; gap: 8px; }
.detail-field pre { flex: 1; min-width: 0; margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; }
.field-value { display: flex; align-items: flex-start; gap: 8px; width: 100%; }
.field-value > .n-input { flex: 1; min-width: 0; }
.field-value > .n-select { flex: 1; min-width: 0; }
.custom-fields { display: flex; flex-direction: column; gap: 12px; width: 100%; }
.custom-field { display: flex; flex-direction: column; gap: 8px; }
</style>
