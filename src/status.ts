// Status bar copy in the built-in style: "83% 2d 3h" — percentage used plus time until reset.
import { formatCost, formatTokens } from './format'
import type { CreditsResult, CreditsWindow, UsageTotals } from './shared'

/** "5h", "35m", "2d 3h", "22d 18h" — the same granularity Orca's own usage items use. */
export function formatCountdown(milliseconds: number): string {
  if (!Number.isFinite(milliseconds)) return ''
  if (milliseconds <= 0) return 'now'
  const minutes = Math.ceil(milliseconds / 60_000)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  const rest = hours % 24
  return rest > 0 ? `${days}d ${rest}h` : `${days}d`
}

/** The 5-hour and weekly windows, falling back to whatever else the API reported. */
function primaryWindows(windows: readonly CreditsWindow[]): CreditsWindow[] {
  const preferred = ['fiveHour', 'weekly']
    .map((id) => windows.find((window) => window.id === id))
    .filter((window): window is CreditsWindow => window !== undefined)
  return preferred.length > 0 ? preferred : windows.slice(0, 2)
}

function windowPercent(window: CreditsWindow): string | null {
  return window.usedPct === null ? null : `${Math.round(window.usedPct)}%`
}

function windowPart(window: CreditsWindow, now: number): string | null {
  const percent = windowPercent(window)
  if (percent === null) return null
  return window.resetsAt === null ? percent : `${percent} ${formatCountdown(window.resetsAt - now)}`
}

/** "CC 19% 35m · 32% 3d", or null when the API has no usable window. */
export function creditsStatus(credits: CreditsResult, now: number): string | null {
  if (credits.status !== 'ok') return null
  const parts = primaryWindows(credits.windows)
    .map((window) => windowPart(window, now))
    .filter((part): part is string => part !== null)
  return parts.length > 0 ? `CC ${parts.join(' · ')}` : null
}

/** Local-only fallback used when no API data is available. */
export function fallbackStatus(today: UsageTotals): string {
  if (today.messages === 0) return 'CC $0.00'
  return `CC ${formatCost(today.costUsd)} · ${formatTokens(today.totalTokens)}`
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

export function statusTooltip(
  today: UsageTotals,
  credits: CreditsResult,
  now: number
): string {
  if (credits.status === 'ok') {
    const parts: string[] = ['Command Code']
    if (credits.plan) parts.push(credits.plan)
    for (const window of credits.windows) {
      const percent = windowPercent(window) ?? 'n/a'
      const amounts =
        window.used !== null && window.cap !== null
          ? ` ${formatCost(window.used)}/${formatCost(window.cap)}`
          : ''
      const reset =
        window.resetsAt === null
          ? ''
          : `, resets in ${formatCountdown(window.resetsAt - now)}`
      parts.push(`${window.label} ${percent}${amounts}${reset}`)
    }
    const balance = credits.balances.find((entry) => entry.id === 'credits') ?? credits.balances[0]
    if (balance) parts.push(`${balance.label} ${formatCost(balance.remaining)}`)
    if (credits.periodSpentUsd !== null) {
      parts.push(`spent ${formatCost(credits.periodSpentUsd)} this period`)
    }
    parts.push(credits.source)
    return parts.join(' · ')
  }

  const base = `Command Code today: ${formatTokens(today.totalTokens)} tokens, ${formatCost(
    today.costUsd
  )} estimated across ${today.messages} messages`
  switch (credits.status) {
    case 'no-key':
      return `${base} · credits: no API key`
    case 'expired':
      return `${base} · credits: login expired`
    case 'rejected':
      return `${base} · credits: key rejected`
    case 'error':
      return `${base} · credits: ${credits.message}`
  }
}
