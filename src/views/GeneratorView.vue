<script setup lang="ts">
import { computed, ref } from 'vue'
import { NButton, NCard, NInputNumber, NSlider, NSpace, NSwitch, NText } from 'naive-ui'
import AppShell from '../components/common/AppShell.vue'

const length = ref(20)
const uppercase = ref(true)
const lowercase = ref(true)
const numbers = ref(true)
const symbols = ref(true)
const password = ref('')
const strength = computed(() => length.value >= 24 ? '非常强' : length.value >= 16 ? '强' : length.value >= 10 ? '一般' : '弱')
function generate() {
  const sets = [uppercase.value ? 'ABCDEFGHJKLMNPQRSTUVWXYZ' : '', lowercase.value ? 'abcdefghijkmnopqrstuvwxyz' : '', numbers.value ? '23456789' : '', symbols.value ? '!@#$%^&*()-_=+' : ''].join('')
  if (!sets) { password.value = ''; return }
  const bytes = crypto.getRandomValues(new Uint32Array(length.value))
  password.value = Array.from(bytes, (byte) => sets[byte % sets.length]).join('')
}
</script>

<template>
  <AppShell>
    <div class="page-heading"><n-text depth="3">工具</n-text><h1>密码生成器</h1></div>
    <n-card class="generator-card" bordered>
      <n-input v-model:value="password" readonly placeholder="生成安全密码" />
      <div class="strength"><n-text depth="3">强度</n-text><n-text strong>{{ strength }}</n-text></div>
      <div class="control"><n-text>长度</n-text><n-input-number v-model:value="length" :min="8" :max="128" /></div>
      <n-slider v-model:value="length" :min="8" :max="64" />
      <div class="switches"><n-space vertical><n-switch v-model:value="uppercase">大写字母</n-switch><n-switch v-model:value="lowercase">小写字母</n-switch><n-switch v-model:value="numbers">数字</n-switch><n-switch v-model:value="symbols">符号</n-switch></n-space></div>
      <n-button type="primary" block @click="generate">生成密码</n-button>
    </n-card>
  </AppShell>
</template>

<style scoped>
.page-heading h1 { margin: 4px 0 24px; font-size: 26px; }
.generator-card { max-width: 560px; }
.strength, .control { display: flex; justify-content: space-between; align-items: center; margin-top: 18px; }
.switches { margin: 20px 0; }
</style>
