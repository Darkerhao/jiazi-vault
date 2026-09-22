<script setup lang="ts">
import { ref } from 'vue'
import { NAlert, NButton, NCard, NSpace, NText, useMessage } from 'naive-ui'
import { callCommand } from '../../services/ipc'
import { useVaultStore } from '../../stores/vault'
import type { TransferFormat } from '../../../electron/contracts'

const busy = ref(false)
const message = useMessage()
const vault = useVaultStore()

async function exportFile(format: TransferFormat) {
  if (busy.value) return
  busy.value = true
  try {
    const name = await callCommand('export_plaintext', { format })
    if (name) message.success(`明文文件已保存：${name}`)
  } catch { message.error('导出失败，请检查目标位置权限，或重新解锁后重试。') }
  finally { busy.value = false }
}

async function importFile() {
  if (busy.value) return
  busy.value = true
  try {
    const count = await callCommand('import_plaintext')
    if (count === null) return
    if (count === 0) { message.info('文件中没有凭证'); return }
    await vault.load()
    message.success(`已导入 ${count} 条凭证`)
  } catch { message.error('导入失败，未新增凭证。请检查文件格式、权限，或重新解锁后重试。') }
  finally { busy.value = false }
}
</script>

<template>
  <n-card title="JSON / CSV 导入导出" class="transfer-card" bordered>
    <n-alert type="warning" :show-icon="false">导出文件包含明文密码和私钥。导出前需要再次确认，请妥善保管文件。</n-alert>
    <p><n-text depth="3">导出有效凭证及项目名称，不含回收站。导入会追加新条目，重复导入会产生重复凭证。</n-text></p>
    <details>
      <summary>导入格式说明</summary>
      <p>支持本应用导出的文件。JSON 为对象数组；CSV 首行为字段名，必填 type、title。项目使用 project 名称；tags 为 JSON 数组，fields 为 JSON 对象；favorite 为 true 或 false。</p>
      <p>示例：<code>[{"type":"login","title":"示例账号","username":"user","password":"secret"}]</code></p>
      <p>CSV 中以公式符号或单引号开头的文本使用单引号转义，重新导入时还原。建议使用 JSON 保留完整文本。完整加密备份请使用上方备份功能。</p>
    </details>
    <n-space class="transfer-actions">
      <n-button :disabled="busy" @click="importFile">导入 JSON / CSV</n-button>
      <n-button :disabled="busy" @click="exportFile('json')">导出 JSON</n-button>
      <n-button :disabled="busy" @click="exportFile('csv')">导出 CSV</n-button>
      <n-text v-if="busy" depth="3">正在处理…</n-text>
    </n-space>
  </n-card>
</template>

<style scoped>
.transfer-card { max-width: 700px; margin-top: 24px; }
.transfer-actions { margin-top: 20px; }
summary { cursor: pointer; }
code { overflow-wrap: anywhere; }
</style>
