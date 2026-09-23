<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { NAlert, NButton, NCard, NCheckbox, NForm, NFormItem, NInput, NLayout, NSpin, NText } from 'naive-ui'
import { useAuthStore } from '../stores/auth'
import { vaultService } from '../services/vault'
import type { BiometricStatus } from '../../electron/contracts'
import BackupRestore from '../components/common/BackupRestore.vue'

const router = useRouter()
const auth = useAuthStore()
const password = ref('')
const confirmation = ref('')
const step = ref<'welcome' | 'password' | 'confirm' | 'security'>('welcome')
const acknowledged = ref(false)
const biometric = ref<BiometricStatus | null>(null)
const localError = ref<string | null>(null)
const isCreating = computed(() => auth.hasVault === false)
const titles = { welcome: '欢迎使用 Jiazi Vault', password: '设置主密码', confirm: '确认主密码', security: '安全须知' }
const now = ref(Date.now())
const remaining = computed(() => Math.max(0, Math.ceil((auth.retryAt - now.value) / 1000)))
const clock = setInterval(() => { now.value = Date.now() }, 250)
onMounted(async () => {
  void auth.checkStatus()
  try { biometric.value = await vaultService.biometricStatus() } catch { /* Master password remains available. */ }
})
onUnmounted(() => clearInterval(clock))

function back() {
  localError.value = null
  if (step.value === 'password') { password.value = ''; step.value = 'welcome' }
  else if (step.value === 'confirm') { confirmation.value = ''; step.value = 'password' }
  else if (step.value === 'security') { acknowledged.value = false; step.value = 'confirm' }
}

async function unlockBiometric() {
  password.value = ''
  localError.value = null
  auth.notice = null
  if (await auth.unlockBiometric()) await router.push('/vault')
}

async function submit() {
  if (auth.busy || remaining.value) return
  auth.notice = null
  localError.value = null
  if (isCreating.value) {
    if (step.value === 'welcome') { step.value = 'password'; return }
    if (password.value.length < 8) {
      localError.value = '主密码至少需要 8 个字符。'
      return
    }
    if (step.value === 'password') { step.value = 'confirm'; return }
    if (password.value !== confirmation.value) {
      localError.value = '两次输入的主密码不一致。'
      return
    }
    if (step.value === 'confirm') { step.value = 'security'; return }
    if (!acknowledged.value) return
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
      <h1>{{ isCreating ? titles[step] : '解锁保险库' }}</h1>
      <n-text v-if="isCreating && step === 'welcome'" depth="3" class="intro">凭证只保存在此设备。<br>无需账号，无云端同步，无追踪。</n-text>
      <n-text v-else-if="isCreating && step === 'password'" depth="3" class="intro">设置至少 8 个字符的主密码，建议使用较长且独有的密码短语。</n-text>
      <n-text v-else-if="isCreating && step === 'confirm'" depth="3" class="intro">再次输入主密码，确认你已记住它。</n-text>
      <n-form class="unlock-form" :disabled="auth.busy" @submit.prevent="submit">
        <n-form-item v-if="!isCreating || step === 'password'" :show-label="false">
          <n-input v-model:value="password" type="password" show-password-on="click" placeholder="主密码" autofocus :input-props="{ autocomplete: isCreating ? 'new-password' : 'current-password' }" />
        </n-form-item>
        <n-form-item v-if="isCreating && step === 'confirm'" :show-label="false">
          <n-input v-model:value="confirmation" type="password" show-password-on="click" placeholder="确认主密码" autofocus :input-props="{ autocomplete: 'new-password' }" />
        </n-form-item>
        <template v-if="isCreating && step === 'security'">
          <n-alert type="warning" :show-icon="false" class="security-note">主密码无法找回。忘记主密码后，保险库将无法解锁。请牢记主密码并定期创建加密备份；恢复备份需要备份创建时的主密码。</n-alert>
          <n-checkbox v-model:checked="acknowledged" class="acknowledgement">我已了解，并会妥善保管主密码</n-checkbox>
        </template>
        <n-button type="primary" block :loading="auth.busy" :disabled="remaining > 0 || (isCreating && step === 'security' && !acknowledged)" attr-type="submit">{{ remaining ? `${remaining} 秒后重试` : !isCreating ? '解锁' : step === 'welcome' ? '开始创建' : step === 'security' ? '创建保险库' : '下一步' }}</n-button>
        <n-button v-if="isCreating && step !== 'welcome'" block text class="secondary-action" :disabled="auth.busy" @click="back">上一步</n-button>
      </n-form>
      <n-button v-if="!isCreating && biometric?.enabled && biometric.available" block class="secondary-action" :disabled="auth.busy" @click="unlockBiometric">使用 {{ biometric.label }} 解锁</n-button>
      <n-text v-if="!isCreating && biometric?.enabled && !biometric.available" depth="3" class="secondary-action">{{ biometric.label }} 当前不可用，请使用主密码解锁。</n-text>
      <n-alert v-if="remaining" type="warning" :show-icon="false" class="unlock-error" role="status">尝试次数过多，请在 {{ remaining }} 秒后重试。</n-alert>
      <n-alert v-if="localError || auth.error" type="error" :show-icon="false" class="unlock-error">{{ localError || auth.error }}</n-alert>
      <n-alert v-if="auth.notice" type="success" :show-icon="false" class="unlock-error">{{ auth.notice }}</n-alert>
      <div v-if="!isCreating || step === 'welcome'" class="restore-action"><BackupRestore /></div>
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
.secondary-action { margin-top: 16px; }
.acknowledgement { margin: 20px 0; }
</style>
