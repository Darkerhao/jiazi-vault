import { callCommand } from './ipc'
import type { PasswordOptions } from '../types/desktop'

export const generatorService = {
  generate: (options: PasswordOptions) => callCommand('generate_password', options),
}
