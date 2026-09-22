import { useMessage } from 'naive-ui'
import { clipboardService } from '../services/clipboard'
import { useVaultStore } from '../stores/vault'
import { useAuthStore } from '../stores/auth'

export function useClipboard() {
  const message = useMessage()
  const vault = useVaultStore()
  const auth = useAuthStore()
  async function copy(text: string, itemId?: string) {
    if (!text) return
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
  return { copy }
}
