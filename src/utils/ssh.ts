import type { VaultItemSummary } from '../types/vault'

/** Produces text for the user's shell; never executes a connection or includes a secret. */
export function sshCommand(item: Pick<VaultItemSummary, 'host' | 'username' | 'port'>, powershell: boolean): string | null {
  const host = item.host?.trim()
  if (!host || host.startsWith('-') || /[\s\x00-\x1f\x7f]/.test(host) || /[\x00-\x1f\x7f]/.test(item.username ?? '')) return null
  const quote = (value: string) => `'${value.replace(/'/g, powershell ? "''" : "'\\''")}'`
  const args = ['ssh']
  if (item.port !== undefined) args.push('-p', String(item.port))
  if (item.username) args.push('-l', quote(item.username))
  args.push('--', quote(host))
  return args.join(' ')
}
