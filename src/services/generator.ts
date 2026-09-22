import { callCommand } from './ipc'
import type { PasswordOptions } from '../../electron/password-generator'

export const generatorService = {
  generate: (options: PasswordOptions) => callCommand('generate_password', options),
}
