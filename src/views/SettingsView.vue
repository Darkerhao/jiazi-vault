<script setup lang="ts">
import { computed } from 'vue'
import { NCard, NForm, NFormItem, NSelect, NText } from 'naive-ui'
import AppShell from '../components/common/AppShell.vue'
import { useSettingsStore } from '../stores/settings'

const settings = useSettingsStore()
const themeOptions = [
  { label: '跟随系统', value: 'system' },
  { label: '浅色', value: 'light' },
  { label: '深色', value: 'dark' },
]
const clipboardOptions = [
  { label: '从不', value: 'never' },
  ...[5, 10, 15, 30, 60].map((value) => ({ label: `${value} 秒`, value })),
]
const autoLockOptions = [
  { label: '从不', value: 0 },
  ...[5, 15, 30, 60].map((value) => ({ label: `${value} 分钟`, value })),
]
const autoLockValue = computed({
  get: () => settings.autoLockMinutes ?? 0,
  set: (value: number) => { settings.autoLockMinutes = value === 0 ? null : value },
})
</script>

<template>
  <AppShell>
    <div class="page-heading"><n-text depth="3">偏好设置</n-text><h1>设置</h1></div>
    <n-card class="settings-card" bordered>
      <n-form label-placement="left" label-width="180">
        <n-form-item label="主题"><n-select v-model:value="settings.themeMode" :options="themeOptions" /></n-form-item>
        <n-form-item label="剪贴板清除时间"><n-select v-model:value="settings.clipboardClearTimeout" :options="clipboardOptions" /></n-form-item>
        <n-form-item label="自动锁定"><n-select v-model:value="autoLockValue" :options="autoLockOptions" /></n-form-item>
      </n-form>
    </n-card>
  </AppShell>
</template>

<style scoped>
.page-heading h1 { margin: 4px 0 24px; font-size: 26px; }
.settings-card { max-width: 700px; }
</style>
