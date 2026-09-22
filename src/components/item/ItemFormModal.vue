<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { NButton, NForm, NFormItem, NInput, NModal, NSelect, NSpace, useMessage } from 'naive-ui'
import { useVaultStore } from '../../stores/vault'
import { useClipboard } from '../../composables/useClipboard'
import { ENVIRONMENT_OPTIONS, ITEM_TYPE_LABELS, ITEM_TYPE_OPTIONS, TYPE_FIELDS, type FieldDef, type SupportedType } from '../../utils/item-fields'
import type { Environment, ItemInput, ItemType, VaultItem } from '../../types/vault'

const props = defineProps<{ show: boolean; item: VaultItem | null; draft?: { type?: SupportedType; password?: string; projectId?: string; environment?: Environment } }>()
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

const isEdit = computed(() => props.item !== null)
const typeOptions = computed(() => type.value === 'custom' ? [...ITEM_TYPE_OPTIONS, { label: ITEM_TYPE_LABELS.custom, value: 'custom' }] : ITEM_TYPE_OPTIONS)
const fields = computed<FieldDef[]>(() => {
  const standard = TYPE_FIELDS[type.value === 'custom' ? 'password' : type.value]
  const known = new Set(standard.filter((field) => field.target === 'field').map((field) => field.key))
  const imported = Object.keys(props.item?.fields ?? {}).filter((key) => !known.has(key))
    .map((key): FieldDef => ({ key: `field:${key}`, fieldKey: key, label: key, kind: 'password', target: 'field' }))
  return [...standard, ...imported]
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
}

function readField(item: VaultItem | null, field: FieldDef): string | null {
  if (!item) return null
  if (field.target === 'field') return item.fields?.[field.fieldKey ?? field.key] ?? null
  if (field.target === 'port') return item.port != null ? String(item.port) : null
  return item[field.target] ?? null
}

function onTypeChange(value: unknown) {
  type.value = value as SupportedType
  resetValues(null)
}

function buildItem(): ItemInput {
  const item: ItemInput = {
    type: type.value,
    title: title.value.trim(),
    favorite: props.item?.favorite ?? false,
    username: props.item?.username, password: props.item?.password, url: props.item?.url,
    host: props.item?.host, port: props.item?.port, notes: props.item?.notes,
  }
  if (environment.value) item.environment = environment.value
  if (projectId.value) item.projectId = projectId.value
  const parsedTags = Array.from(new Set(tags.value.split(/[,，\s]+/).map((s) => s.trim()).filter(Boolean)))
  if (parsedTags.length) item.tags = parsedTags
  for (const field of fields.value) {
    if (field.target !== 'field') delete item[field.target]
    const value = values[field.key]
    if (!value) continue
    if (field.target === 'port') { item.port = Number(value); continue }
    if (field.target === 'notes') { item.notes = value; continue }
    if (field.target === 'field') { item.fields ??= Object.create(null) as Record<string, string>; item.fields[field.fieldKey ?? field.key] = value; continue }
    item[field.target] = value
  }
  return item
}

async function save() {
  if (!title.value.trim() || saving.value) return
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
    style="width: 640px"
    :bordered="false"
    @update:show="(v) => !v && emit('close')"
  >
    <n-form label-placement="left" label-width="96">
      <n-form-item label="类型">
        <n-select :value="type" :options="typeOptions" :disabled="isEdit" @update:value="onTypeChange" />
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
        <n-input v-if="field.kind === 'text'" v-model:value="values[field.key]" :placeholder="field.label" />
        <n-input
          v-else-if="field.kind === 'password'"
          v-model:value="values[field.key]"
          type="password"
          show-password-on="click"
          :placeholder="field.label"
        >
          <template #suffix>
            <n-button text size="tiny" @click="copy(String(values[field.key] ?? ''), item?.id)">复制</n-button>
          </template>
        </n-input>
        <n-input v-else v-model:value="values[field.key]" type="textarea" :autosize="{ minRows: 3 }" :placeholder="field.label" />
      </n-form-item>
      <n-form-item label="标签">
        <n-input v-model:value="tags" placeholder="逗号分隔，如 production, api" />
      </n-form-item>
    </n-form>
    <template #footer>
      <n-space justify="end">
        <n-button @click="emit('close')">取消</n-button>
        <n-button type="primary" :loading="saving" :disabled="!title.trim()" @click="save">保存</n-button>
      </n-space>
    </template>
  </n-modal>
</template>
