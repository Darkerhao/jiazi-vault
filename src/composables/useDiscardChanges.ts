import { onBeforeUnmount } from 'vue'
import { useDialog } from 'naive-ui'
import { useAuthStore } from '../stores/auth'

export function useDiscardChanges(isDirty: () => boolean, isBusy: () => boolean) {
  const dialog = useDialog(), auth = useAuthStore()
  let pending: Promise<boolean> | null = null
  let dismiss: (() => void) | undefined
  onBeforeUnmount(() => dismiss?.())

  return function confirmDiscard(changed = isDirty()): Promise<boolean> {
    if (!auth.unlocked) return Promise.resolve(true)
    if (isBusy()) return Promise.resolve(false)
    if (!changed) return Promise.resolve(true)
    if (pending) return pending
    pending = new Promise<boolean>((resolve) => {
      const prompt = dialog.warning({
        title: '放弃未保存的修改？', content: '继续操作将丢弃未保存的内容。',
        positiveText: '放弃修改', negativeText: '继续编辑',
        onPositiveClick: () => resolve(true), onAfterLeave: () => resolve(false),
      })
      dismiss = () => { prompt.destroy(); resolve(false) }
    }).finally(() => { pending = null; dismiss = undefined })
    return pending
  }
}
