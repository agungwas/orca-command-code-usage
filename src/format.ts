/** Small, dependency-free formatters shared by the worker (status bar) and the panel. */

function trimDecimal(value: number): string {
  return value
    .toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2)
    .replace(/\.0+$/, '')
    .replace(/(\.\d*[1-9])0+$/, '$1')
}

/** 1234 -> "1.23k", 2000000 -> "2M". Keeps the status bar and narrow tables short. */
export function formatTokens(value: number): string {
  const n = Number.isFinite(value) && value > 0 ? value : 0
  if (n < 1_000) return String(Math.round(n))
  if (n < 1_000_000) return `${trimDecimal(n / 1_000)}k`
  if (n < 1_000_000_000) return `${trimDecimal(n / 1_000_000)}M`
  return `${trimDecimal(n / 1_000_000_000)}B`
}

/** Exact token count with grouping: 42126 -> "42,126". */
export function formatCount(value: number): string {
  const n = Number.isFinite(value) && value > 0 ? Math.round(value) : 0
  return n.toLocaleString()
}

/** Dollars, with more precision while the amount is small: 0.00557 -> "$0.0056". */
export function formatCost(value: number): string {
  const n = Number.isFinite(value) && value > 0 ? value : 0
  if (n === 0) return '$0.00'
  if (n < 0.01) return `$${n.toFixed(4)}`
  if (n < 1) return `$${n.toFixed(3)}`
  return `$${n.toFixed(2)}`
}

const DAY_FORMAT: Intl.DateTimeFormatOptions = {
  weekday: 'short',
  month: 'short',
  day: 'numeric'
}
const DAY_FORMAT_YEAR: Intl.DateTimeFormatOptions = { ...DAY_FORMAT, year: 'numeric' }

/** "2026-11-14" -> "Sat, Nov 14" (adds the year for another year). */
export function formatDay(key: string, now: Date = new Date()): string {
  const parts = key.split('-').map(Number)
  const [year, month, day] = parts
  if (parts.length !== 3 || !year || !month || !day) return key
  const date = new Date(year, month - 1, day)
  if (Number.isNaN(date.getTime())) return key
  return date.toLocaleDateString(undefined, year === now.getFullYear() ? DAY_FORMAT : DAY_FORMAT_YEAR)
}

export function describeError(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return 'Unknown error'
}
