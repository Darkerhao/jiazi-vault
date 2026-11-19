import type { IpcCommands } from '../types/ipc'
import { desktopBridge } from './desktop'

export async function callCommand<K extends keyof IpcCommands>(
  command: K,
  ...args: IpcCommands[K]['args'] extends undefined ? [] : [IpcCommands[K]['args']]
): Promise<IpcCommands[K]['result']> {
  return desktopBridge.invoke(command, args[0])
}
