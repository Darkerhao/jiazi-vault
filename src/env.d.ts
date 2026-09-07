/// <reference types="vite/client" />

import type { DesktopBridge } from './types/ipc'

declare global {
  interface Window {
    jiaziVault?: DesktopBridge
  }
}

export {}
