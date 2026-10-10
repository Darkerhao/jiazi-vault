import { useMessage } from 'naive-ui'
import { clipboardService } from '../services/clipboard'
import { useVaultStore } from '../stores/vault'
import { useAuthStore } from '../stores/auth'
import { primarySecret } from '../utils/item-fields'
import { vaultErrorMessage } from '../utils/vault-error'

export function useClipboard() {
  const message = useMessage()
  const vault = useVaultStore()
  const auth = useAuthStore()
  async function copy(text: string, itemId?: string) {
    const revision = auth.sessionRevision
    try {
      const usedAt = await clipboardService.copy(text, itemId)
      if (revision !== auth.sessionRevision) return
      if (itemId && usedAt !== null) vault.applyUsage(itemId, usedAt)
      message.success('已复制到剪贴板')
    } catch {
      message.error('复制失败')
    }
  }

  /** One-click copy of an item's main value without opening the editor. */
  async function copyItem(id: string) {
    const revision = auth.sessionRevision
    let item
    try { item = await vault.get(id, false) }
    catch (cause) {
      if (revision === auth.sessionRevision) message.error(vaultErrorMessage(cause, '读取凭证失败，请重试。'))
      return
    }
    if (revision !== auth.sessionRevision) return
    if (!item) return
    if (item.type !== 'env') {
      const secret = primarySecret(item)
      if (secret) await copy(secret, id)
      else message.info('此凭证没有可快捷复制的内容，请打开后选择字段。')
      return
    }
    try {
      const result = await clipboardService.copyEnv(item.fields ?? {}, id)
      if (revision !== auth.sessionRevision || !result) return
      if (result.usedAt !== null) vault.applyUsage(id, result.usedAt)
      message.success('已复制完整 .env 内容')
    } catch {
      if (revision === auth.sessionRevision) message.error('复制失败，请打开变量集检查后重试。')
    }
  }
  return { copy, copyItem }
}
