import { ref } from 'vue'
import { useMessage } from 'naive-ui'
import { linkService } from '../services/links'
import { useVaultStore } from '../stores/vault'
import { useAuthStore } from '../stores/auth'
import { normalizeExternalUrl } from '../utils/links'
import { vaultErrorMessage } from '../utils/vault-error'

export function useOpenUrl() {
  const message = useMessage()
  const vault = useVaultStore()
  const auth = useAuthStore()
  const opening = ref<string | null>(null)

  async function open(url: string | null | undefined, itemId?: string): Promise<boolean> {
    const target = url?.trim()
    if (!target) {
      message.info('此凭证未设置 URL')
      return false
    }
    const href = normalizeExternalUrl(target)
    if (!href) {
      message.error('URL 格式不正确，仅支持 http 或 https 链接')
      return false
    }
    if (opening.value) return false
    const revision = auth.sessionRevision
    const key = itemId ?? href
    opening.value = key
    try {
      const usedAt = await linkService.open(href, itemId)
      if (revision !== auth.sessionRevision) return false
      if (itemId && usedAt !== null) vault.applyUsage(itemId, usedAt)
      return true
    } catch (cause) {
      if (revision === auth.sessionRevision) message.error(vaultErrorMessage(cause, '无法打开链接，请检查默认浏览器设置。'))
      return false
    } finally {
      if (opening.value === key) opening.value = null
    }
  }

  return { open, opening }
}
