import { useMessage } from 'naive-ui'
import { clipboardService } from '../services/clipboard'

export function useClipboard() {
  const message = useMessage()
  async function copy(text: string) {
    if (!text) return
    try {
      await clipboardService.copy(text)
      message.success('已复制到剪贴板')
    } catch {
      message.error('复制失败')
    }
  }
  return { copy }
}
