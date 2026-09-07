import type { IpcCommands } from '../types/ipc'

export async function callCommand<K extends keyof IpcCommands>(
  command: K,
  ...args: IpcCommands[K]['args'] extends undefined ? [] : [IpcCommands[K]['args']]
): Promise<IpcCommands[K]['result']> {
  if (!window.jiaziVault) {
    throw new Error('DESKTOP_RUNTIME_UNAVAILABLE')
  }
  return window.jiaziVault.invoke(command, args[0])
}
