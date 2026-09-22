<script setup lang="ts">
import { onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { NAlert, NButton, NCard, NInput, NInputNumber, NProgress, NSlider, NSpace, NSwitch, NText } from 'naive-ui'
import AppShell from '../components/common/AppShell.vue'
import ItemFormModal from '../components/item/ItemFormModal.vue'
import { useClipboard } from '../composables/useClipboard'
import { useVaultStore } from '../stores/vault'
import { generatorService } from '../services/generator'
import type { GeneratedPassword, PasswordOptions } from '../../electron/password-generator'

const options = reactive<PasswordOptions>({ length: 20, uppercase: true, lowercase: true, numbers: true, symbols: true, excludeAmbiguous: true })
const generated = ref<GeneratedPassword | null>(null)
const busy = ref(false)
const error = ref('')
const saving = ref(false)
const { copy } = useClipboard()
const vault = useVaultStore()
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
    if (current === request) generated.value = result
  } catch {
    if (current === request) error.value = '生成失败，请重试'
  } finally { if (current === request) busy.value = false }
}
watch(options, generate)
onMounted(() => { void vault.load(); void generate() })
onUnmounted(() => { request++; generated.value = null })
</script>

<template>
  <AppShell>
    <div class="page-heading"><n-text depth="3">工具</n-text><h1>密码生成器</h1></div>
    <n-card class="generator-card" bordered>
      <n-input :value="generated?.password ?? ''" readonly type="textarea" :autosize="{ minRows: 2 }" placeholder="生成安全密码" class="password-output" />
      <div class="strength"><n-text depth="3">强度</n-text><n-text strong>{{ generated ? `${generated.strength} · ${generated.entropy.toFixed(1)} bits` : '尚未生成' }}</n-text></div>
      <n-progress type="line" :percentage="Math.min(100, (generated?.entropy ?? 0) / 128 * 100)" :show-indicator="false" />
      <n-text depth="3" class="entropy-note">熵值按当前随机生成规则估算。</n-text>
      <div class="control"><n-text>密码长度</n-text><n-input-number v-model:value="options.length" :min="8" :max="128" :precision="0" aria-label="密码长度" /></div>
      <n-slider v-model:value="options.length" :min="8" :max="128" :step="1" aria-label="密码长度滑块" />
      <div class="switches"><div v-for="option in switches" :key="option.key" class="switch-row"><n-text>{{ option.label }}</n-text><n-switch v-model:value="options[option.key]" :aria-label="option.label" /></div></div>
      <n-alert v-if="error" type="warning" class="error">{{ error }}</n-alert>
      <n-space><n-button type="primary" :loading="busy" @click="generate">重新生成</n-button><n-button :disabled="!generated || busy" @click="copy(generated!.password)">复制密码</n-button><n-button :disabled="!generated || busy || vault.loading || !!vault.error" @click="saving = true">保存到保险库</n-button></n-space>
    </n-card>
    <ItemFormModal v-if="saving && generated" :show="saving" :item="null" :draft="{ type: 'password', password: generated.password }" @close="saving = false" />
  </AppShell>
</template>

<style scoped>
.page-heading h1 { margin: 4px 0 24px; font-size: 26px; }
.generator-card { max-width: 560px; }
.strength, .control { display: flex; justify-content: space-between; align-items: center; margin-top: 18px; }
.switches { margin: 20px 0; }
.switch-row { display: flex; justify-content: space-between; align-items: center; margin: 14px 0; }
.entropy-note { display: block; margin-top: 8px; font-size: 12px; }
.control { margin-bottom: 12px; }
.password-output { font-family: monospace; }
.error { margin-bottom: 16px; }
</style>
