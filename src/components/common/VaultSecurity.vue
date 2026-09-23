<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { NAlert, NButton, NCard, NForm, NFormItem, NInput, NText, useMessage } from 'naive-ui'
import { vaultService } from '../../services/vault'
import { useAuthStore } from '../../stores/auth'
import type { BiometricStatus } from '../../../electron/contracts'

const auth = useAuthStore()
const message = useMessage()
const biometric = ref<BiometricStatus | null>(null)
const currentPassword = ref('')
const newPassword = ref('')
const confirmation = ref('')
const enrollmentPassword = ref('')
const busy = ref(false)
const error = ref('')

onMounted(async () => {
  try { biometric.value = await vaultService.biometricStatus() }
  catch { error.value = '无法读取系统解锁状态，请重新进入设置。' }
})

function failure(cause: unknown) {
  const detail = cause instanceof Error ? cause.message : ''
  error.value = detail.includes('INVALID_PASSWORD') ? '当前主密码不正确。'
    : detail.includes('UNLOCK_RATE_LIMITED') ? '密码尝试次数过多，请稍后重试。'
    : detail.includes('BIOMETRIC') ? '系统认证已取消或不可用，请重试。'
    : '操作未完成，请重新解锁后重试。'
}

async function changePassword() {
  if (busy.value) return
  error.value = ''
  if (currentPassword.value.length < 8 || newPassword.value.length < 8) { error.value = '主密码至少需要 8 个字符。'; return }
  if (newPassword.value !== confirmation.value) { error.value = '两次输入的新主密码不一致。'; return }
  if (currentPassword.value === newPassword.value) { error.value = '新主密码必须与当前主密码不同。'; return }
  busy.value = true
  try {
    await vaultService.changePassword(currentPassword.value, newPassword.value)
    auth.notice = '主密码已修改，请使用新主密码解锁。系统快捷解锁需重新启用。'
  } catch (cause) { failure(cause) }
  finally { currentPassword.value = ''; newPassword.value = ''; confirmation.value = ''; busy.value = false }
}

async function toggleBiometric() {
  if (busy.value || !biometric.value) return
  error.value = ''
  if (!biometric.value.enabled && enrollmentPassword.value.length < 8) { error.value = '请输入当前主密码，至少 8 个字符。'; return }
  busy.value = true
  try {
    if (biometric.value.enabled) await vaultService.disableBiometric()
    else await vaultService.enableBiometric(enrollmentPassword.value)
    biometric.value = await vaultService.biometricStatus()
    message.success(biometric.value.enabled ? '已启用系统快捷解锁' : '已关闭系统快捷解锁')
  } catch (cause) { failure(cause) }
  finally { enrollmentPassword.value = ''; busy.value = false }
}
</script>

<template>
  <n-card title="保险库安全" class="settings-card security-card" bordered>
    <n-alert v-if="error" type="error" class="security-error">{{ error }}</n-alert>
    <h2>{{ biometric?.label ?? '系统快捷解锁' }}</h2>
    <n-text depth="3">启用后，此设备的系统认证可替代主密码。主密码仍用于备份恢复和其他设备。Windows Hello 可使用指纹、人脸或系统 PIN。</n-text>
    <n-form v-if="biometric" class="security-form" :disabled="busy" @submit.prevent="toggleBiometric">
      <n-alert v-if="!biometric.available" type="info" class="security-error">此设备暂不可用，请在系统设置中配置 Windows Hello 或 Touch ID。你仍可使用主密码。</n-alert>
      <n-form-item v-if="!biometric.enabled && biometric.available" label="当前主密码">
        <n-input v-model:value="enrollmentPassword" type="password" placeholder="启用前验证主密码" show-password-on="click" :input-props="{ autocomplete: 'current-password' }" />
      </n-form-item>
      <n-button :loading="busy" :disabled="!biometric.enabled && !biometric.available" attr-type="submit">{{ biometric.enabled ? '关闭系统快捷解锁' : '启用系统快捷解锁' }}</n-button>
    </n-form>
    <h2 class="password-heading">修改主密码</h2>
    <n-text depth="3">修改后需重新解锁，并重新启用系统快捷解锁。已有加密备份仍使用创建备份时的主密码。</n-text>
    <n-form class="security-form" :disabled="busy" @submit.prevent="changePassword">
      <n-form-item label="当前主密码"><n-input v-model:value="currentPassword" type="password" placeholder="当前主密码" show-password-on="click" :input-props="{ autocomplete: 'current-password' }" /></n-form-item>
      <n-form-item label="新主密码"><n-input v-model:value="newPassword" type="password" placeholder="新主密码（至少 8 个字符）" show-password-on="click" :input-props="{ autocomplete: 'new-password' }" /></n-form-item>
      <n-form-item label="确认新主密码"><n-input v-model:value="confirmation" type="password" placeholder="确认新主密码" show-password-on="click" :input-props="{ autocomplete: 'new-password' }" /></n-form-item>
      <n-button type="primary" :loading="busy" attr-type="submit">修改主密码并锁定</n-button>
    </n-form>
  </n-card>
</template>

<style scoped>
.security-card { margin-top: 24px; max-width: 700px; }
h2 { margin: 0 0 12px; font-size: 16px; }
.security-form { margin-top: 20px; }
.password-heading { margin-top: 32px; }
.security-error { margin-bottom: 20px; }
</style>
