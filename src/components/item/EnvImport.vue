<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { NAlert, NButton, NCheckbox, NInput, NSpace, NTag, NText } from 'naive-ui'
import { ENV_MAX_BYTES, diffEnvFields, parseEnv } from '../../../electron/env'
import { callCommand } from '../../services/ipc'
import { useAuthStore } from '../../stores/auth'

const props = defineProps<{ fields: Record<string, string> }>()
const emit = defineEmits<{ apply: [fields: Record<string, string>]; cancel: [] }>()
const auth = useAuthStore()
const source = ref(''), filename = ref(''), error = ref('')
const previewing = ref(false), loading = ref(false)
const revealed = ref(new Set<number>())
const replacements = ref(new Set<string>())
watch([source, () => props.fields], () => { replacements.value.clear(); revealed.value.clear() })
let disposed = false
onBeforeUnmount(() => { disposed = true; source.value = ''; revealed.value.clear() })
const preview = computed(() => {
  if (new TextEncoder().encode(source.value).length > ENV_MAX_BYTES) return { entries: [], issues: [{ line: 1, message: '内容不能超过 1 MiB。' }] }
  return parseEnv(source.value)
})
const issues = computed(() => preview.value.issues)
const changes = computed(() => diffEnvFields(props.fields, preview.value.entries))
const applicable = computed(() => changes.value.filter(entry => entry.kind === 'added' || (entry.kind === 'changed' && replacements.value.has(entry.name))))

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
  if (!previewing.value || issues.value.length || !applicable.value.length) return
  emit('apply', Object.fromEntries(applicable.value.map(({ name, value }) => [name, value])))
}
</script>

<template>
  <div class="env-import">
    <n-text depth="3">新增变量会加入编辑；已有值仅在勾选后替换，其他变量保留。保存后才写入保险库。</n-text>
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
        <div v-for="(entry, index) in changes" :key="entry.line" class="preview-row">
          <div class="preview-name">
            <span>第 {{ entry.line }} 行 · {{ entry.name }}</span>
            <n-tag size="small" :type="entry.kind === 'added' ? 'success' : entry.kind === 'changed' ? 'warning' : 'default'">{{ entry.kind === 'added' ? '新增' : entry.kind === 'changed' ? '值已变化' : '未变化' }}</n-tag>
            <n-checkbox v-if="entry.kind === 'changed'" :checked="replacements.has(entry.name)" :label="`替换变量${entry.name}`" @update:checked="checked => checked ? replacements.add(entry.name) : replacements.delete(entry.name)" />
          </div>
          <pre><template v-if="entry.kind === 'changed'">当前：{{ revealed.has(index) ? entry.previous || '（空值）' : '••••••••' }}
导入：</template>{{ revealed.has(index) ? (entry.value || '（空值）') : (entry.value ? '••••••••' : '（空值）') }}</pre>
          <n-button size="small" :aria-label="`${revealed.has(index) ? '隐藏' : '预览'}导入变量${entry.name}`" @click="revealed.has(index) ? revealed.delete(index) : revealed.add(index)">{{ revealed.has(index) ? '隐藏' : '显示' }}</n-button>
        </div>
      </div>
      <n-alert v-for="(issue, index) in issues" :key="index" type="error" :show-icon="false">第 {{ issue.line }} 行：{{ issue.message }}</n-alert>
      <n-alert v-if="!preview.entries.length && !issues.length" type="warning">没有可导入的变量。</n-alert>
      <n-text v-if="changes.length && !applicable.length" depth="3">没有新增变量；请勾选需要替换的变量，或取消导入。</n-text>
      <n-button type="primary" :disabled="!!issues.length || !applicable.length" @click="apply">将 {{ applicable.length }} 个变量加入编辑</n-button>
    </template>
  </div>
</template>

<style scoped>
.env-import { display: flex; flex-direction: column; gap: 12px; }
.preview-rows { max-height: 260px; overflow: auto; }
.preview-row { display: flex; gap: 12px; align-items: flex-start; padding: 6px 0; }
.preview-name { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: flex-start; gap: 6px; overflow-wrap: anywhere; }
.preview-row pre { flex: 1; min-width: 0; margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
</style>
