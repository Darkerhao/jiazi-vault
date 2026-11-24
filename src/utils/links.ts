/** Normalize a credential URL to http/https, accepting bare hosts and host:port values. */
export function normalizeExternalUrl(value: string | null | undefined): string | null {
  const target = value?.trim()
  if (!target) return null
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(target)?.[1]?.toLowerCase()
  const hostPort = /^(?:localhost|\[[0-9a-f:]+\]|(?:\d{1,3}\.){3}\d{1,3}|[a-z0-9.-]+\.[a-z]{2,}):\d+(?:[/?#]|$)/i.test(target)
  if (scheme && !['http', 'https'].includes(scheme) && !hostPort) return null
  try {
    const url = new URL(/^https?:\/\//i.test(target) ? target : `https://${target}`)
    return ['http:', 'https:'].includes(url.protocol) && url.hostname ? url.href : null
  } catch {
    return null
  }
}
