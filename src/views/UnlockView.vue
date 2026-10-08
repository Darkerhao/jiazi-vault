<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { NAlert, NButton, NCard, NCheckbox, NForm, NFormItem, NInput, NLayout, NSpin, NText } from 'naive-ui'
import type { InputInst } from 'naive-ui'
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
const loadingBiometric = ref(true)
const passwordMode = ref(false)
const passwordInput = ref<InputInst | null>(null)
const biometricButton = ref<InstanceType<typeof NButton> | null>(null)
const localError = ref<string | null>(null)
const isCreating = computed(() => auth.hasVault === false)
const canUseBiometric = computed(() => !isCreating.value && biometric.value?.enabled && biometric.value.available)
const biometricMode = computed(() => canUseBiometric.value && biometric.value?.preferred && !passwordMode.value)
const titles = { welcome: '欢迎使用 Keystill', password: '设置主密码', confirm: '确认主密码', security: '安全须知' }
const now = ref(Date.now())
const remaining = computed(() => Math.max(0, Math.ceil((auth.retryAt - now.value) / 1000)))
const clock = setInterval(() => { now.value = Date.now() }, 250)
watch(() => auth.sessionRevision, async (_revision, _previous, onCleanup) => {
  let canceled = false
  onCleanup(() => { canceled = true })
  loadingBiometric.value = true
  passwordMode.value = false
  biometric.value = null
  await auth.checkStatus()
  if (!canceled && auth.hasVault && !auth.databaseError) {
    try {
      const status = await vaultService.biometricStatus()
      if (!canceled) biometric.value = status
    } catch { /* Master password remains available. */ }
  }
  if (!canceled) loadingBiometric.value = false
}, { immediate: true })
watch([loadingBiometric, biometricMode], () => {
  if (loadingBiometric.value) return
  if (biometricMode.value) biometricButton.value?.$el.focus()
  else passwordInput.value?.focus()
}, { flush: 'post' })
onUnmounted(() => clearInterval(clock))

function back() {
  localError.value = null
  if (step.value === 'password') { password.value = ''; step.value = 'welcome' }
  else if (step.value === 'confirm') { confirmation.value = ''; step.value = 'password' }
  else if (step.value === 'security') { acknowledged.value = false; step.value = 'confirm' }
}

async function unlockBiometric() {
  if (auth.busy) return
  password.value = ''
  localError.value = null
  auth.notice = null
  if (await auth.unlockBiometric()) await router.push('/vault')
}

async function submit() {
  if (auth.busy) return
  if (biometricMode.value) { await unlockBiometric(); return }
  if (remaining.value) return
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
  <n-layout class="unlock-page" content-style="min-height: 100vh; display: grid; place-items: center; padding: 24px;">
    <n-card class="unlock-card" bordered>
      <img class="unlock-icon" src="/brand/icon.svg" alt="" width="64" height="64">
      <n-text depth="1" class="unlock-brand">Keystill <span>密序</span></n-text>
      <n-spin v-if="!auth.isReady || loadingBiometric" class="loading" />
      <template v-else-if="auth.databaseError">
        <h1>无法打开保险库</h1>
        <n-alert type="error" :show-icon="false" class="security-note">数据文件可能损坏或暂时无法访问。请检查文件权限后重新启动，或从加密备份恢复。恢复前会保留原文件。</n-alert>
        <div class="restore-action"><BackupRestore /></div>
      </template>
      <template v-else>
      <h1>{{ isCreating ? titles[step] : '解锁保险库' }}</h1>
      <n-text v-if="isCreating && step === 'welcome'" depth="3" class="intro">凭证只保存在此设备。<br>无需账号，无云端同步，无追踪。</n-text>
      <n-text v-if="isCreating && step === 'welcome'" depth="3" class="intro">密码、备注和自定义字段加密保存；名称、账号、主机等元数据在本地明文保存。</n-text>
      <n-text v-else-if="isCreating && step === 'password'" depth="3" class="intro">设置至少 8 个字符的主密码，建议使用较长且独有的密码短语。</n-text>
      <n-text v-else-if="isCreating && step === 'confirm'" depth="3" class="intro">再次输入主密码，确认你已记住它。</n-text>
      <n-form class="unlock-form" :disabled="auth.busy" @submit.prevent="submit">
        <template v-if="biometricMode">
          <n-text depth="3" class="intro biometric-intro">使用 {{ biometric?.label }} 验证身份，即可解锁保险库。</n-text>
          <n-button ref="biometricButton" type="primary" block :loading="auth.busy" attr-type="submit">使用 {{ biometric?.label }} 解锁</n-button>
          <n-button block class="secondary-action" :disabled="auth.busy" @click="passwordMode = true">使用主密码解锁</n-button>
        </template>
        <template v-else>
        <n-form-item v-if="!isCreating || step === 'password'" :show-label="false">
          <n-input ref="passwordInput" v-model:value="password" type="password" show-password-on="click" placeholder="主密码" autofocus :input-props="{ autocomplete: isCreating ? 'new-password' : 'current-password' }" />
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
        <n-button v-if="canUseBiometric" block class="secondary-action" :disabled="auth.busy" @click="unlockBiometric">使用 {{ biometric?.label }} 解锁</n-button>
        </template>
      </n-form>
      <n-text v-if="!isCreating && biometric?.enabled && !biometric.available" depth="3" class="secondary-action">{{ biometric.label }} 当前不可用，请使用主密码解锁。</n-text>
      <n-alert v-if="remaining && !biometricMode" type="warning" :show-icon="false" class="unlock-error" role="status">尝试次数过多，请在 {{ remaining }} 秒后重试。</n-alert>
      <n-alert v-if="localError || auth.error" type="error" :show-icon="false" class="unlock-error">{{ localError || auth.error }}</n-alert>
      <n-alert v-if="auth.notice" type="success" :show-icon="false" class="unlock-error">{{ auth.notice }}</n-alert>
      <div v-if="!isCreating || step === 'welcome'" class="restore-action"><BackupRestore /></div>
      </template>
    </n-card>
  </n-layout>
</template>

<style scoped>
.unlock-page { min-height: 100vh; }
.unlock-card { width: min(440px, 100%); text-align: center; border-radius: 24px; padding: 12px; }
.unlock-icon { display: block; margin: 12px auto 18px; width: 76px; height: 76px; }
.unlock-brand { display: block; font-size: 26px; font-weight: 650; letter-spacing: -.6px; margin-bottom: 24px; }
.unlock-brand span { font-size: 13px; font-weight: 400; letter-spacing: 3px; margin-left: 8px; opacity: .7; }
h1 { margin: 8px 0 24px; font-size: 24px; }
.loading { margin: 28px 0 18px; }
.intro { display: block; margin: -12px 0 20px; line-height: 1.7; }
.biometric-intro { text-align: center; }
.unlock-form { text-align: left; }
.unlock-error { margin-top: 16px; text-align: left; }
.security-note { margin-top: 16px; text-align: left; line-height: 1.6; }
.restore-action { margin-top: 20px; }
.secondary-action { margin-top: 16px; }
.acknowledgement { margin: 20px 0; }
</style>
