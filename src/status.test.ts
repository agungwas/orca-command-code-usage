import { assert, test } from 'orca/testing'

import {
  creditsStatus,
  fallbackStatus,
  formatCountdown,
  statusText,
  statusTooltip
} from './status'
import { emptyTotals, type CreditsResult, type UsageTotals } from './shared'

const NOW = Date.parse('2026-11-15T12:00:00Z')
const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

function today(): UsageTotals {
  return {
    inputTokens: 100,
    outputTokens: 5,
    cacheReadTokens: 10,
    cacheWriteTokens: 0,
    totalTokens: 115,
    costUsd: 0.25,
    messages: 1
  }
}

const OK: CreditsResult = {
  status: 'ok',
  fetchedAt: NOW,
  account: 'acme',
  plan: 'pro',
  source: 'Orca secrets',
  windows: [
    { id: 'fiveHour', label: '5-hour', usedPct: 19, used: 0.55, cap: 3, resetsAt: NOW + 35 * MINUTE },
    { id: 'weekly', label: 'Weekly', usedPct: 32, used: 1.91, cap: 6, resetsAt: NOW + 3 * DAY },
    {
      id: 'billing-period',
      label: 'Billing · 30-day',
      usedPct: 18,
      used: 1.82,
      cap: 9.91,
      resetsAt: NOW + 26 * DAY
    }
  ],
  balances: [{ id: 'credits', label: 'Credits', remaining: 8.09 }],
  periodSpentUsd: 1.82,
  periodEndsAt: NOW + 26 * DAY
}

test('formats reset time like the built-in usage items', () => {
  assert.equal(formatCountdown(0), 'now')
  assert.equal(formatCountdown(30_000), '1m')
  assert.equal(formatCountdown(35 * MINUTE), '35m')
  assert.equal(formatCountdown(5 * HOUR), '5h')
  assert.equal(formatCountdown(51 * HOUR), '2d 3h')
  assert.equal(formatCountdown(22 * DAY + 18 * HOUR), '22d 18h')
})

test('shows the 5-hour and weekly windows with reset countdowns', () => {
  assert.equal(creditsStatus(OK, NOW), 'CC 19% 35m · 32% 3d')
  assert.equal(statusText(today(), OK, NOW), 'CC 19% 35m · 32% 3d')
})

test('falls back to local cost and tokens without API data', () => {
  assert.equal(fallbackStatus(today()), 'CC $0.250 · 115')
  assert.equal(fallbackStatus(emptyTotals()), 'CC $0.00')
  assert.equal(statusText(today(), { status: 'no-key' }, NOW), 'CC $0.250 · 115')
})

test('tooltip describes every window and the balance', () => {
  const tooltip = statusTooltip(today(), OK, NOW)
  assert.ok(tooltip.includes('pro'))
  assert.ok(tooltip.includes('5-hour 19% $0.550/$3.00, resets in 35m'))
  assert.ok(tooltip.includes('Weekly 32%'))
  assert.ok(tooltip.includes('Credits $8.09'))
  assert.ok(tooltip.includes('spent $1.82 this period'))

  const noKey = statusTooltip(today(), { status: 'no-key' }, NOW)
  assert.ok(noKey.includes('115 tokens'))
  assert.ok(noKey.includes('credits: no API key'))
})
