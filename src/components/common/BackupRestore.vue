<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import { NAlert, NButton, NForm, NFormItem, NInput, NModal, NSpace } from 'naive-ui'
import { backupService } from '../../services/backup'
import { useAuthStore } from '../../stores/auth'
import { useSettingsStore } from '../../stores/settings'

const auth = useAuthStore()
const settings = useSettingsStore()
const show = ref(false)
const password = ref('')
const busy = ref(false)
const error = ref<string | null>(null)

function close() {
  show.value = false
  password.value = ''
  error.value = null
}

async function restore() {
  if (busy.value) return
  if (password.value.length < 8) {
    error.value = '请输入备份创建时的主密码，至少 8 个字符。'
    return
  }
  busy.value = true
  error.value = null
  try {
    const restored = await backupService.restore(password.value)
    if (restored) {
      auth.notice = '备份已恢复，请使用备份的主密码解锁。'
      await Promise.all([auth.checkStatus(), settings.load()])
    }
    close()
  } catch {
    error.value = '恢复失败：请检查备份主密码、文件完整性和文件权限。当前保险库未被替换。'
  } finally {
    password.value = ''
    busy.value = false
  }
}

onBeforeUnmount(() => { password.value = '' })
</script>

<template>
  <n-button :disabled="auth.busy" @click="show = true">从加密备份恢复</n-button>
  <n-modal :show="show" preset="card" title="恢复加密备份" style="width: 440px" :closable="!busy" :mask-closable="!busy" :close-on-esc="!busy" @update:show="(value) => !value && close()">
    <n-alert type="warning" :show-icon="false" style="margin-bottom: 20px">恢复将整体替换当前凭证、回收站和设置。请先备份当前保险库。</n-alert>
    <n-form @submit.prevent="restore">
      <n-form-item label="备份主密码">
        <n-input v-model:value="password" type="password" placeholder="备份创建时使用的主密码" :disabled="busy" autofocus />
      </n-form-item>
      <n-alert v-if="error" type="error" :show-icon="false" style="margin-bottom: 16px">{{ error }}</n-alert>
      <n-space justify="end">
        <n-button :disabled="busy" @click="close">取消</n-button>
        <n-button type="primary" attr-type="submit" :loading="busy">选择文件并恢复</n-button>
      </n-space>
    </n-form>
  </n-modal>
</template>
