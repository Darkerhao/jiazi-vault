import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { join } from 'node:path'
import { app, safeStorage, systemPreferences, type BrowserWindow } from 'electron'
import type { BiometricProvider } from './biometric-vault.js'

const execute = promisify(execFile)

export function createBiometricProvider(getWindow: () => BrowserWindow | null): BiometricProvider {
  const platform = process.platform
  async function windowsHello(action: 'status' | 'verify') {
    const binary = join(app.isPackaged ? process.resourcesPath : app.getAppPath(),
      app.isPackaged ? 'windows-hello' : 'output/windows-hello', 'WindowsHello.exe')
    const args: string[] = [action]
    if (action === 'verify') {
      const window = getWindow()
      if (!window || window.isDestroyed()) throw new Error('BIOMETRIC_UNAVAILABLE')
      const handle = window.getNativeWindowHandle()
      args.push((handle.length === 8 ? handle.readBigUInt64LE() : BigInt(handle.readUInt32LE())).toString())
    }
    const { stdout } = await execute(binary, args, { windowsHide: true, timeout: 120_000, maxBuffer: 1024 })
    return stdout.trim()
  }

  return {
    label: platform === 'win32' ? 'Windows Hello' : platform === 'darwin' ? 'Touch ID' : '生物识别',
    async available() {
      try {
        if (platform !== 'win32' && platform !== 'darwin') return false
        if (!await safeStorage.isAsyncEncryptionAvailable()) return false
        return platform === 'darwin' ? systemPreferences.canPromptTouchID() : await windowsHello('status') === 'available'
      } catch { return false }
    },
    async verify() {
      try {
        if (platform === 'darwin') await systemPreferences.promptTouchID('解锁 Jiazi Vault 保险库')
        else if (platform !== 'win32' || await windowsHello('verify') !== 'verified') throw new Error()
      } catch { throw new Error('BIOMETRIC_CANCELED_OR_FAILED') }
    },
    protect: (key) => safeStorage.encryptStringAsync(key.toString('base64')),
    async unprotect(encrypted) {
      const { result } = await safeStorage.decryptStringAsync(encrypted)
      const key = Buffer.from(result, 'base64')
      if (key.length !== 32) { key.fill(0); throw new Error('BIOMETRIC_INVALID') }
      return key
    },
  }
}
