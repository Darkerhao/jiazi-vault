export function validExpiry(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

export type ExpiryState = 'none' | 'invalid' | 'expired' | 'soon' | 'valid'
function localDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).toString().padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/** Credentials remain valid through the selected date in the user's local timezone. */
export function expiryState(value?: string, now = new Date()): ExpiryState {
  if (!value) return 'none'
  if (!validExpiry(value)) return 'invalid'
  if (value < localDate(now)) return 'expired'
  const nextWeek = new Date(now)
  nextWeek.setDate(nextWeek.getDate() + 7)
  return value <= localDate(nextWeek) ? 'soon' : 'valid'
}
