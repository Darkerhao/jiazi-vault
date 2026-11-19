import { invoke, isTauri } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type { DesktopBridge } from '../types/ipc'

const pendingListeners = new Set<Promise<void>>()
function subscribe<T>(event: string, callback: (value: T) => void): UnlistenFn {
  if (!isTauri()) return () => {}
  let disposed = false
  let stop: UnlistenFn | undefined
  const ready = listen<T>(event, ({ payload }) => { if (!disposed) callback(payload) })
    .then(unlisten => { if (disposed) unlisten(); else stop = unlisten })
  pendingListeners.add(ready)
  void ready.then(() => pendingListeners.delete(ready), () => pendingListeners.delete(ready))
  return () => { disposed = true; stop?.() }
}

export const desktopBridge: DesktopBridge = {
  onCloseRequest: callback => subscribe('close_requested', callback),
  onUpdateState: callback => subscribe('update_state', callback),
  onBackupChanged: callback => subscribe('backup_changed', callback),
  onItemsChanged: callback => subscribe('items_changed', callback),
  onDesktopAction: callback => subscribe('desktop_action', callback),
  onLocked: callback => subscribe('vault_locked', callback),
  invoke: async (command, args) => {
    if (!isTauri()) throw new Error('DESKTOP_RUNTIME_UNAVAILABLE')
    try { return await invoke('vault_command', { command, args: args ?? null }) }
    catch (cause) { throw cause instanceof Error ? cause : new Error(String(cause)) }
  },
}

export async function waitForDesktopEvents() {
  await Promise.all(pendingListeners)
}
