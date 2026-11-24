import { useMessage } from 'naive-ui'
import { clipboardService } from '../services/clipboard'
import { useVaultStore } from '../stores/vault'
import { useAuthStore } from '../stores/auth'
import { useSettingsStore } from '../stores/settings'
import { vaultErrorMessage } from '../utils/vault-error'

export function useClipboard() {
  const message = useMessage()
  const vault = useVaultStore()
  const auth = useAuthStore()
  const settings = useSettingsStore()

  function notice(label: string) {
    const timeout = settings.preferences?.clipboardClearTimeout
    const suffix = timeout === 'never' ? '，不会自动清除' : typeof timeout === 'number' ? `，${timeout} 秒后清除` : ''
    return `已复制${/^[A-Za-z]/.test(label) ? ` ${label}` : label}${suffix}`
  }

  async function copy(text: string, itemId?: string, label = '内容'): Promise<boolean> {
    const revision = auth.sessionRevision
    try {
      const usedAt = await clipboardService.copy(text, itemId)
      if (revision !== auth.sessionRevision) return false
      if (itemId && usedAt !== null) vault.applyUsage(itemId, usedAt)
      message.success(notice(label))
      return true
    } catch {
      message.error('复制失败')
      return false
    }
  }

  /** Copy an item's main value without opening the editor; decryption stays in Rust. */
  async function copyItem(id: string, label: string): Promise<boolean> {
    const revision = auth.sessionRevision
    try {
      const result = await clipboardService.copyItem(id)
      if (revision !== auth.sessionRevision || !result) return false
      if (!result.copied) {
        message.info('此凭证没有可快捷复制的内容，请打开后选择字段。')
        return false
      }
      if (result.usedAt !== null) vault.applyUsage(id, result.usedAt)
      message.success(notice(label))
      return true
    } catch (cause) {
      if (revision === auth.sessionRevision) message.error(vaultErrorMessage(cause, '复制失败，请确认保险库已解锁且凭证内容有效。'))
      return false
    }
  }
  return { copy, copyItem, notice }
}
