// Status bar copy in the built-in style: "83% 2d 3h" — percentage used plus time until reset.
import { formatCost, formatTokens } from './format'
import type { CreditsResult, CreditsWindow, UsageTotals } from './shared'

// Text mark in front of the numbers. An empty mark uses only the manifest icon.
const STATUS_MARK = '⌘'

function marked(body: string): string {
  return STATUS_MARK ? `${STATUS_MARK} ${body}` : body
}

/** Compact form for the status bar and tooltip: "17m", "1h17m", "2d3h", "22d18h". */
export function formatStatusCountdown(milliseconds: number): string {
  if (!Number.isFinite(milliseconds)) return ''
  if (milliseconds <= 0) return 'now'
  const minutes = Math.max(1, Math.floor(milliseconds / 60_000))
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const minutesLeft = minutes % 60
  if (hours < 24) return minutesLeft > 0 ? `${hours}h${minutesLeft}m` : `${hours}h`
  const days = Math.floor(hours / 24)
  const hoursLeft = hours % 24
  return hoursLeft > 0 ? `${days}d${hoursLeft}h` : `${days}d`
}

/** The 5-hour, weekly and 30-day billing windows, in that order. */
function primaryWindows(windows: readonly CreditsWindow[]): CreditsWindow[] {
  const preferred = ['fiveHour', 'weekly', 'billing-period']
    .map((id) => windows.find((window) => window.id === id))
    .filter((window): window is CreditsWindow => window !== undefined)
  return preferred.length > 0 ? preferred : windows.slice(0, 3)
}

function windowPercent(window: CreditsWindow): string | null {
  return window.usedPct === null ? null : `${Math.round(window.usedPct)}%`
}

function windowPart(window: CreditsWindow, now: number): string | null {
  const percent = windowPercent(window)
  if (percent === null) return null
  return window.resetsAt === null
    ? percent
    : `${percent} ${formatStatusCountdown(window.resetsAt - now)}`
}

/** "CC 19% 35m · 32% 3d", or null when the API has no usable window. */
export function creditsStatus(credits: CreditsResult, now: number): string | null {
  if (credits.status !== 'ok') return null
  const parts = primaryWindows(credits.windows)
    .map((window) => windowPart(window, now))
    .filter((part): part is string => part !== null)
  return parts.length > 0 ? marked(parts.join(' · ')) : null
}

/** Local-only fallback used when no API data is available. */
export function fallbackStatus(today: UsageTotals): string {
  if (today.messages === 0) return marked('$0.00')
  return marked(`${formatCost(today.costUsd)} · ${formatTokens(today.totalTokens)}`)
}

export function statusText(today: UsageTotals, credits: CreditsResult, now: number): string {
  return creditsStatus(credits, now) ?? fallbackStatus(today)
}

/** Red once a window is close to its cap, like Orca's own usage item. */
export function statusTone(credits: CreditsResult): 'neutral' | 'warning' | 'danger' {
  if (credits.status !== 'ok') return 'neutral'
  const highest = Math.max(...credits.windows.map((window) => window.usedPct ?? 0))
  if (highest >= 90) return 'danger'
  if (highest >= 75) return 'warning'
  return 'neutral'
}

function shortWindowLabel(window: CreditsWindow): string {
  if (window.id === 'fiveHour') return '5h'
  if (window.id === 'weekly') return 'wk'
  if (window.id === 'billing-period') return '30d'
  return window.label
}

export function statusTooltip(
  today: UsageTotals,
  credits: CreditsResult,
  now: number
): string {
  if (credits.status === 'ok') {
    const parts: string[] = [credits.plan ?? 'Command Code']
    for (const window of primaryWindows(credits.windows)) {
      const percent = windowPercent(window)
      if (percent === null) continue
      parts.push(
        window.resetsAt === null
          ? `${shortWindowLabel(window)} ${percent}`
          : `${shortWindowLabel(window)} ${percent} (${formatStatusCountdown(window.resetsAt - now)})`
      )
    }
    const balance = credits.balances.find((entry) => entry.id === 'credits') ?? credits.balances[0]
    if (balance) parts.push(`${formatCost(balance.remaining)} left`)
    return parts.join(' · ')
  }

  const base = `${formatTokens(today.totalTokens)} tokens · ${formatCost(today.costUsd)} today`
  switch (credits.status) {
    case 'no-key':
      return `${base} · no API key`
    case 'expired':
      return `${base} · login expired`
    case 'rejected':
      return `${base} · key rejected`
    case 'error':
      return `${base} · credits unavailable`
  }
}
