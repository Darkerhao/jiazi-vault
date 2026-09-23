<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { NAlert, NButton, NInput, NSpace, NText } from 'naive-ui'
import { ENV_MAX_BYTES, parseEnv } from '../../../electron/env'
import { callCommand } from '../../services/ipc'
import { useAuthStore } from '../../stores/auth'

const props = defineProps<{ names: string[] }>()
const emit = defineEmits<{ apply: [fields: Record<string, string>]; cancel: [] }>()
const auth = useAuthStore()
const source = ref(''), filename = ref(''), error = ref('')
const previewing = ref(false), loading = ref(false)
const revealed = ref(new Set<number>())
let disposed = false
onBeforeUnmount(() => { disposed = true; source.value = ''; revealed.value.clear() })
const preview = computed(() => {
  if (new TextEncoder().encode(source.value).length > ENV_MAX_BYTES) return { entries: [], issues: [{ line: 1, message: '内容不能超过 1 MiB。' }] }
  return parseEnv(source.value)
})
const issues = computed(() => [...preview.value.issues, ...preview.value.entries
  .filter((entry) => props.names.includes(entry.name))
  .map((entry) => ({ line: entry.line, message: `变量 ${entry.name} 已在当前变量集中，请先修改名称或删除已有变量。` }))])

async function chooseFile() {
  loading.value = true
  error.value = ''
  const revision = auth.sessionRevision
  try {
    const file = await callCommand('read_env_file')
    if (disposed || revision !== auth.sessionRevision || !file) return
    source.value = file.contents
    filename.value = file.name
    revealed.value.clear()
    previewing.value = true
  } catch {
    if (!disposed && revision === auth.sessionRevision) error.value = '无法读取文件。请选择不超过 1 MiB 的 UTF-8 文本文件。'
  } finally { loading.value = false }
}

function apply() {
  if (!previewing.value || issues.value.length || !preview.value.entries.length) return
  emit('apply', Object.fromEntries(preview.value.entries.map(({ name, value }) => [name, value])))
}
</script>

<template>
  <div class="env-import">
    <n-text depth="3">导入会追加变量，保存后才写入保险库。重名变量需要先处理。</n-text>
    <n-space>
      <n-button :loading="loading" @click="chooseFile">选择 .env 文件</n-button>
      <n-button v-if="previewing" @click="previewing = false; revealed.clear()">编辑导入内容</n-button>
      <n-button @click="emit('cancel')">取消导入</n-button>
    </n-space>
    <n-alert v-if="error" type="error">{{ error }}</n-alert>
    <n-input v-if="!previewing" v-model:value="source" type="textarea" :autosize="{ minRows: 4, maxRows: 8 }" placeholder="粘贴 .env 内容，例如 API_KEY=..." :input-props="{ 'aria-label': '.env 导入内容', spellcheck: false }" />
    <n-button v-if="!previewing" :disabled="!source.trim()" @click="previewing = true">预览解析结果</n-button>
    <template v-else>
      <n-text>{{ filename || '粘贴内容' }} · {{ preview.entries.length }} 个变量</n-text>
      <div class="preview-rows">
        <div v-for="(entry, index) in preview.entries" :key="entry.line" class="preview-row">
          <span>第 {{ entry.line }} 行 · {{ entry.name }}</span>
          <pre>{{ revealed.has(index) ? (entry.value || '（空值）') : (entry.value ? '••••••••' : '（空值）') }}</pre>
          <n-button size="small" :aria-label="`${revealed.has(index) ? '隐藏' : '预览'}导入变量${entry.name}`" @click="revealed.has(index) ? revealed.delete(index) : revealed.add(index)">{{ revealed.has(index) ? '隐藏' : '显示' }}</n-button>
        </div>
      </div>
      <n-alert v-for="(issue, index) in issues" :key="index" type="error" :show-icon="false">第 {{ issue.line }} 行：{{ issue.message }}</n-alert>
      <n-alert v-if="!preview.entries.length && !issues.length" type="warning">没有可导入的变量。</n-alert>
      <n-button type="primary" :disabled="!!issues.length || !preview.entries.length" @click="apply">将 {{ preview.entries.length }} 个变量加入编辑</n-button>
    </template>
  </div>
</template>

<style scoped>
.env-import { display: flex; flex-direction: column; gap: 12px; }
.preview-rows { max-height: 260px; overflow: auto; }
.preview-row { display: flex; gap: 12px; align-items: flex-start; padding: 6px 0; }
.preview-row > span { flex: 1; overflow-wrap: anywhere; }
.preview-row pre { flex: 1; min-width: 0; margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
</style>
