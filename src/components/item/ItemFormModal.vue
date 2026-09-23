<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { NAlert, NButton, NForm, NFormItem, NInput, NModal, NSelect, NSpace, useMessage } from 'naive-ui'
import { useVaultStore } from '../../stores/vault'
import { useClipboard } from '../../composables/useClipboard'
import { ENVIRONMENT_OPTIONS, ITEM_TYPE_OPTIONS, TYPE_FIELDS, type FieldDef } from '../../utils/item-fields'
import type { Environment, ItemInput, ItemType, VaultItem } from '../../types/vault'

const props = defineProps<{ show: boolean; item: VaultItem | null; draft?: { type?: ItemType; password?: string; projectId?: string; environment?: Environment } }>()
const emit = defineEmits<{ (event: 'close'): void }>()

const vault = useVaultStore()
const message = useMessage()
const { copy } = useClipboard()

const type = ref<ItemType>('login')
const title = ref('')
const environment = ref<Environment | null>(null)
const projectId = ref<string | null>(null)
const saving = ref(false)
const projectOptions = computed(() => vault.projects.map((p) => ({ label: p.name, value: p.id })))
const tags = ref('')
const values = reactive<Record<string, string | null>>({})
const extraFields = ref<{ id: number; name: string; value: string; visible: boolean }[]>([])
let nextFieldId = 0

const isEdit = computed(() => props.item !== null)
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
  const names = new Set(fields.value.filter((field) => field.target === 'field').map((field) => field.key))
  for (const field of extraFields.value) {
    const name = field.name.trim()
    if (!name) return '请输入字段名称，或删除未使用的字段。'
    if (names.has(name)) return '字段名称不能重复，也不能与当前类型的内置字段重名。'
    names.add(name)
  }
  return ''
})

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
  },
  { immediate: true },
)

function resetValues(item: VaultItem | null) {
  for (const key of Object.keys(values)) delete values[key]
  for (const field of fields.value) values[field.key] = readField(item, field)
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

function onTypeChange(value: ItemType) {
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
  if (!title.value.trim() || fieldError.value || saving.value) return
  saving.value = true
  const input = buildItem()
  const ok = props.item ? await vault.updateItem({ ...input, id: props.item.id, createdAt: props.item.createdAt, updatedAt: props.item.updatedAt }) : await vault.createItem(input)
  saving.value = false
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
    :title="isEdit ? '编辑凭证' : '新建凭证'"
    style="width: 720px; max-width: calc(100vw - 40px)"
    :bordered="false"
    @update:show="(v) => !v && emit('close')"
  >
    <n-form label-placement="left" label-width="96">
      <n-form-item label="类型">
        <n-select :value="type" :options="ITEM_TYPE_OPTIONS" :disabled="isEdit" @update:value="onTypeChange" />
      </n-form-item>
      <n-form-item label="名称" required>
        <n-input v-model:value="title" placeholder="凭证名称" />
      </n-form-item>
      <n-form-item label="项目">
        <n-select v-model:value="projectId" :options="projectOptions" clearable filterable placeholder="选择项目（可选）" />
      </n-form-item>
      <n-form-item label="环境">
        <n-select v-model:value="environment" :options="ENVIRONMENT_OPTIONS" clearable placeholder="选择环境" />
      </n-form-item>
      <n-form-item v-for="field in fields" :key="field.key" :label="field.label">
        <div class="field-value">
          <n-input v-model:value="values[field.key]" :type="field.kind" show-password-on="click" :autosize="field.kind === 'textarea' ? { minRows: 3, maxRows: 8 } : false" :placeholder="field.label" />
          <n-button :disabled="!values[field.key]" :aria-label="`复制${field.label}`" @click="copy(values[field.key] ?? '', item?.id)">复制</n-button>
        </div>
      </n-form-item>
      <n-form-item label="自定义字段">
        <div class="custom-fields">
          <div v-for="field in extraFields" :key="field.id" class="custom-field">
            <div class="field-value">
              <n-input v-model:value="field.name" placeholder="字段名称" aria-label="字段名称" />
              <n-button :aria-label="`删除字段${field.name}`" @click="extraFields = extraFields.filter((entry) => entry.id !== field.id)">删除</n-button>
            </div>
            <div class="field-value">
              <n-input v-if="field.visible" v-model:value="field.value" type="textarea" :autosize="{ minRows: 2, maxRows: 6 }" :placeholder="field.name || '字段值'" :input-props="{ 'aria-label': `字段值${field.name}` }" />
              <n-input v-else :value="field.value ? '••••••••' : ''" readonly placeholder="空值" :input-props="{ 'aria-label': `字段值${field.name}` }" />
              <n-button :aria-label="`${field.visible ? '隐藏' : '显示'}${field.name}`" @click="field.visible = !field.visible">{{ field.visible ? '隐藏' : '显示' }}</n-button>
              <n-button :disabled="!field.value" :aria-label="`复制${field.name || '字段值'}`" @click="copy(field.value, item?.id)">复制</n-button>
            </div>
          </div>
          <n-alert v-if="fieldError" type="warning" :show-icon="false">{{ fieldError }}</n-alert>
          <n-button dashed @click="extraFields.push({ id: nextFieldId++, name: '', value: '', visible: true })">新增字段</n-button>
        </div>
      </n-form-item>
      <n-form-item label="标签">
        <n-input v-model:value="tags" placeholder="逗号分隔，如 production, api" />
      </n-form-item>
    </n-form>
    <template #footer>
      <n-space justify="end">
        <n-button @click="emit('close')">取消</n-button>
        <n-button type="primary" :loading="saving" :disabled="!title.trim() || !!fieldError" @click="save">保存</n-button>
      </n-space>
    </template>
  </n-modal>
</template>

<style scoped>
.field-value { display: flex; align-items: flex-start; gap: 8px; width: 100%; }
.field-value > .n-input { flex: 1; min-width: 0; }
.custom-fields { display: flex; flex-direction: column; gap: 12px; width: 100%; }
.custom-field { display: flex; flex-direction: column; gap: 8px; }
</style>
