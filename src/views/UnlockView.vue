<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { NAlert, NButton, NCard, NForm, NFormItem, NInput, NLayout, NSpin, NText } from 'naive-ui'
import { useAuthStore } from '../stores/auth'
import BackupRestore from '../components/common/BackupRestore.vue'

const router = useRouter()
const auth = useAuthStore()
const password = ref('')
const confirmation = ref('')
const localError = ref<string | null>(null)
const isCreating = computed(() => auth.hasVault === false)
const now = ref(Date.now())
const remaining = computed(() => Math.max(0, Math.ceil((auth.retryAt - now.value) / 1000)))
const clock = setInterval(() => { now.value = Date.now() }, 250)
onMounted(() => auth.checkStatus())
onUnmounted(() => clearInterval(clock))

async function submit() {
  if (auth.busy || remaining.value) return
  auth.notice = null
  localError.value = null
  if (isCreating.value) {
    if (password.value.length < 8) {
      localError.value = '主密码至少需要 8 个字符。'
      return
    }
    if (password.value !== confirmation.value) {
      localError.value = '两次输入的主密码不一致。'
      return
    }
    if (await auth.create(password.value)) {
      password.value = ''
      confirmation.value = ''
      await router.push('/vault')
    }
    return
  }
  if (await auth.unlock(password.value)) {
    password.value = ''
    await router.push('/vault')
  }
}
</script>

<template>
  <n-layout class="unlock-page">
    <n-card class="unlock-card" bordered>
      <div class="unlock-icon">J</div>
      <n-text depth="1">Jiazi Vault</n-text>
      <n-spin v-if="!auth.isReady" class="loading" />
      <template v-else>
      <h1>{{ isCreating ? '创建保险库' : '解锁保险库' }}</h1>
      <n-text v-if="isCreating" depth="3" class="intro">凭证只保存在此设备。请设置一个你能记住的主密码。</n-text>
      <n-form class="unlock-form" @submit.prevent="submit">
        <n-form-item :show-label="false">
          <n-input v-model:value="password" type="password" show-password-on="click" placeholder="主密码" autofocus />
        </n-form-item>
        <n-form-item v-if="isCreating" :show-label="false">
          <n-input v-model:value="confirmation" type="password" show-password-on="click" placeholder="确认主密码" />
        </n-form-item>
        <n-button type="primary" block :loading="auth.busy" :disabled="remaining > 0" attr-type="submit">{{ remaining ? `${remaining} 秒后重试` : isCreating ? '创建保险库' : '解锁' }}</n-button>
      </n-form>
      <n-alert v-if="remaining" type="warning" :show-icon="false" class="unlock-error" role="status">尝试次数过多，请在 {{ remaining }} 秒后重试。</n-alert>
      <n-alert v-if="localError || auth.error" type="error" :show-icon="false" class="unlock-error">{{ localError || auth.error }}</n-alert>
      <n-alert v-if="auth.notice" type="success" :show-icon="false" class="unlock-error">{{ auth.notice }}</n-alert>
      <n-alert v-if="isCreating" type="warning" :show-icon="false" class="security-note">主密码无法找回。忘记主密码后，保险库将无法解锁。</n-alert>
      <div class="restore-action"><BackupRestore /></div>
      </template>
    </n-card>
  </n-layout>
</template>

<style scoped>
.unlock-page { min-height: 100vh; display: grid; place-items: center; padding: 24px; }
.unlock-card { width: min(420px, 100%); text-align: center; }
.unlock-icon { margin: 10px auto 14px; width: 52px; height: 52px; display: grid; place-items: center; border-radius: 14px; background: #8ab4f8; color: #172033; font-weight: 800; font-size: 26px; }
h1 { margin: 8px 0 24px; font-size: 24px; }
.loading { margin: 28px 0 18px; }
.intro { display: block; margin: -12px 0 20px; line-height: 1.7; }
.unlock-form { text-align: left; }
.unlock-error { margin-top: 16px; text-align: left; }
.security-note { margin-top: 16px; text-align: left; line-height: 1.6; }
.restore-action { margin-top: 20px; }
</style>
