<script setup lang="ts">
import { onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { NAlert, NButton, NCard, NInput, NInputNumber, NProgress, NSlider, NSpace, NSwitch, NText } from 'naive-ui'
import { useClipboard } from '../../composables/useClipboard'
import { generatorService } from '../../services/generator'
import type { GeneratedPassword, PasswordOptions } from '../../types/desktop'
import { DEFAULT_PASSWORD_OPTIONS } from '../../types/desktop'
import { useSettingsStore } from '../../stores/settings'

const settings = useSettingsStore()
const options = reactive<PasswordOptions>({ ...DEFAULT_PASSWORD_OPTIONS, ...settings.preferences?.passwordGenerator })
let ready = false
const generated = ref<GeneratedPassword | null>(null)
const busy = ref(false)
const error = ref('')
const { copy } = useClipboard()
const switches = [
  { key: 'uppercase', label: '大写字母' }, { key: 'lowercase', label: '小写字母' },
  { key: 'numbers', label: '数字' }, { key: 'symbols', label: '特殊字符' },
  { key: 'excludeAmbiguous', label: '排除易混淆字符（0 O 1 I l |）' },
] as const
let request = 0

async function generate() {
  const current = ++request
  generated.value = null
  error.value = ''
  busy.value = true
  try {
    if (![options.uppercase, options.lowercase, options.numbers, options.symbols].some(Boolean)) {
      error.value = '请至少选择一种字符类型'
      return
    }
    if (!Number.isInteger(options.length) || options.length < 8 || options.length > 128) {
      error.value = '密码长度需为 8–128 之间的整数'
      return
    }
    const result = await generatorService.generate({ ...options })
    if (current === request) {
      generated.value = result
      if ((Object.keys(options) as (keyof PasswordOptions)[]).some(key => options[key] !== settings.preferences?.passwordGenerator[key])) await settings.update({ passwordGenerator: { ...options } })
    }
  } catch {
    if (current === request) error.value = '生成失败，请重试'
  } finally { if (current === request) busy.value = false }
}
watch(options, () => { if (ready) void generate() }, { flush: 'sync' })
onMounted(async () => {
  if (!settings.preferences) await settings.load()
  Object.assign(options, settings.preferences?.passwordGenerator ?? DEFAULT_PASSWORD_OPTIONS)
  ready = true
  void generate()
})
onUnmounted(() => { request++; generated.value = null })
</script>

<template>
    <n-card class="generator-card" bordered>
      <div class="generator-layout">
      <section class="generator-preview" aria-label="生成结果">
      <n-text depth="3" class="preview-label">随机生成 · 仅在本机处理</n-text>
      <n-input :value="generated?.password ?? ''" readonly type="textarea" :autosize="{ minRows: 2 }" placeholder="生成安全密码" :input-props="{ 'aria-label': '生成的密码' }" class="password-output" />
      <div class="strength"><n-text depth="3">强度</n-text><n-text strong>{{ generated ? `${generated.strength} · ${generated.entropy.toFixed(1)} bits` : '尚未生成' }}</n-text></div>
      <n-progress type="line" :percentage="Math.min(100, (generated?.entropy ?? 0) / 128 * 100)" :show-indicator="false" />
      <n-text depth="3" class="entropy-note">熵值按当前随机生成规则估算。</n-text>
      </section>
      <section class="generator-options" aria-label="生成规则">
      <div class="control"><n-text>密码长度</n-text><n-input-number v-model:value="options.length" :min="8" :max="128" :precision="0" :input-props="{ 'aria-label': '密码长度' }" /></div>
      <n-slider v-model:value="options.length" :min="8" :max="128" :step="1" aria-label="密码长度滑块" />
      <div class="switches"><div v-for="option in switches" :key="option.key" class="switch-row"><n-text>{{ option.label }}</n-text><n-switch v-model:value="options[option.key]" :aria-label="option.label" /></div></div>
      <n-alert v-if="error" type="warning" class="error">{{ error }}</n-alert>
      <n-alert v-if="settings.error" type="error">{{ settings.error }}</n-alert>
      <n-text depth="3" role="status">{{ settings.busy ? '正在保存生成规则…' : '生成规则自动保存，下次继续使用。' }}</n-text>
      </section>
      </div>
      <template #footer>
        <n-space><n-button type="primary" :loading="busy" @click="generate">重新生成</n-button><n-button :disabled="!generated || busy" @click="copy(generated!.password, undefined, '密码')">复制密码</n-button><slot :password="generated?.password" :busy="busy" /></n-space>
      </template>
    </n-card>
</template>

<style scoped>
.generator-card { container: generator / inline-size; }
.generator-layout { display: grid; grid-template-columns: minmax(0, 1fr); gap: 24px; }
.generator-preview { min-width: 0; padding: 20px; border: 1px solid var(--app-divider, var(--n-border-color)); border-radius: 12px; background: var(--app-input, var(--n-color)); }
.generator-options { min-width: 0; }
.preview-label { display: block; margin-bottom: 16px; font-size: 12px; }
.strength, .control { display: flex; justify-content: space-between; align-items: center; margin-top: 18px; }
.switches { margin: 20px 0; }
.switch-row { display: flex; justify-content: space-between; align-items: center; gap: 16px; padding: 12px 0; border-bottom: 1px solid var(--app-divider, var(--n-border-color)); }
.switch-row .n-switch { flex-shrink: 0; }
.entropy-note { display: block; margin-top: 8px; font-size: 12px; }
.control { margin: 0 0 12px; gap: 16px; }
.control .n-input-number { width: 110px; flex-shrink: 0; }
.password-output { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 20px; line-height: 1.6; }
.error { margin-bottom: 16px; }
@container generator (min-width: 760px) {
  .generator-layout { grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr); gap: 32px; }
}
</style>
