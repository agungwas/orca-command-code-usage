// Types and pure helpers safe to load inside the sandboxed panel frame: no Node built-ins here.
export type Period = 'today' | '7d' | '30d' | 'all'

export interface PeriodOption {
  value: Period
  label: string
}

export const PERIODS: readonly PeriodOption[] = [
  { value: 'today', label: 'Today' },
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: 'all', label: 'All time' }
]

export function isPeriod(value: unknown): value is Period {
  return value === 'today' || value === '7d' || value === '30d' || value === 'all'
}

/** Anything that is not one of the four periods reads as "today". */
export function normalizePeriod(value: unknown): Period {
  return isPeriod(value) ? value : 'today'
}

export interface UsageTotals {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  totalTokens: number
  costUsd: number
  messages: number
}

export interface UsageRow extends UsageTotals {
  key: string
  label: string
}

export interface UsageSummary {
  period: Period
  generatedAt: number
  /** Local midnight the period starts at; null for all time. */
  startMs: number | null
  totals: UsageTotals
  /** Today's usage, independent of the selected period (feeds the status bar). */
  today: UsageTotals
  days: UsageRow[]
  projects: UsageRow[]
  models: UsageRow[]
  sessions: number
  projectsScanned: number
  skippedLines: number
  ignoredEntries: number
  readErrors: number
  dirAvailable: boolean
  dirPath: string
  /** The scan stopped early because its consumer went away. */
  aborted: boolean
}

export function emptyTotals(): UsageTotals {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 0,
    costUsd: 0,
    messages: 0
  }
}

/** The local midnight this period starts at: today, 7 days back, 30 days back, or null. */
export function periodStart(period: Period, now: number): number | null {
  if (period === 'all') return null
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  if (period === 'today') return start.getTime()
  start.setDate(start.getDate() - (period === '7d' ? 6 : 29))
  return start.getTime()
}

/** Local calendar day of a timestamp, as YYYY-MM-DD (not UTC: usage is billed by local day). */
export function dayKey(timestamp: number): string {
  const date = new Date(timestamp)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/** One reported limit window (5-hour, weekly, or the billing period). */
export interface CreditsWindow {
  id: string
  label: string
  /** 0-100, or null when the API reported no usable cap. */
  usedPct: number | null
  used: number | null
  cap: number | null
  resetsAt: number | null
}

export interface CreditsBalance {
  id: string
  label: string
  remaining: number
}

/**
 * What the credits block shows. `no-key` is the normal state when no credential resolves; only
 * `ok` carries data from api.commandcode.ai.
 */
export type CreditsResult =
  | { status: 'no-key' }
  | { status: 'expired'; expiresAt: number | null }
  | { status: 'rejected'; message: string }
  | { status: 'error'; message: string }
  | {
      status: 'ok'
      fetchedAt: number
      account: string | null
      plan: string | null
      /** Human-readable credential origin, e.g. "Orca secrets" or "~/.commandcode/auth.json". */
      source: string
      windows: CreditsWindow[]
      balances: CreditsBalance[]
      periodSpentUsd: number | null
      periodEndsAt: number | null
    }
