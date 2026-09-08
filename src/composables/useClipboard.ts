import { useMessage } from 'naive-ui'

export function useClipboard() {
  const message = useMessage()
  async function copy(text: string) {
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      message.success('已复制到剪贴板')
    } catch {
      message.error('复制失败')
    }
  }
  return { copy }
}
