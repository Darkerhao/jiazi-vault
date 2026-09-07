<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { NAlert, NButton, NCard, NForm, NFormItem, NInput, NLayout, NSpace, NText } from 'naive-ui'
import { useAuthStore } from '../stores/auth'

const router = useRouter()
const auth = useAuthStore()
const password = ref('')
async function submit() {
  if (await auth.unlock(password.value)) await router.push('/vault')
}
</script>

<template>
  <n-layout class="unlock-page">
    <n-card class="unlock-card" bordered>
      <div class="unlock-icon">J</div>
      <n-text depth="1">Jiazi Vault</n-text>
      <h1>解锁保险库</h1>
      <n-form @submit.prevent="submit">
        <n-form-item :show-label="false">
          <n-input v-model:value="password" type="password" show-password-on="click" placeholder="主密码" autofocus @keyup.enter="submit" />
        </n-form-item>
        <n-button type="primary" block :loading="auth.busy" attr-type="submit">解锁</n-button>
      </n-form>
      <n-alert v-if="auth.error" type="error" :show-icon="false" class="unlock-error">{{ auth.error }}</n-alert>
      <n-space justify="center" class="biometric"><n-text depth="3">支持 Windows Hello / Touch ID</n-text></n-space>
    </n-card>
  </n-layout>
</template>

<style scoped>
.unlock-page { min-height: 100vh; display: grid; place-items: center; padding: 24px; }
.unlock-card { width: min(420px, 100%); text-align: center; }
.unlock-icon { margin: 10px auto 14px; width: 52px; height: 52px; display: grid; place-items: center; border-radius: 14px; background: #8ab4f8; color: #172033; font-weight: 800; font-size: 26px; }
h1 { margin: 8px 0 24px; font-size: 24px; }
.unlock-error { margin-top: 16px; text-align: left; }
.biometric { margin-top: 24px; }
</style>
