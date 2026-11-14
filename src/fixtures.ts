// Deterministic sample data for `orca plugin check` and the panel tests.
import { formatDay } from './format'
import { emptyTotals, type Period, type UsageRow, type UsageSummary, type UsageTotals } from './shared'

function totals(
  input: number,
  output: number,
  cacheRead: number,
  cacheWrite: number,
  cost: number,
  messages: number
): UsageTotals {
  return {
    inputTokens: input,
    outputTokens: output,
    cacheReadTokens: cacheRead,
    cacheWriteTokens: cacheWrite,
    totalTokens: input + output + cacheRead + cacheWrite,
    costUsd: cost,
    messages
  }
}

function row(key: string, label: string, values: UsageTotals): UsageRow {
  return { key, label, ...values }
}

function dayKey(offset: number): string {
  const day = new Date()
  day.setHours(12, 0, 0, 0)
  day.setDate(day.getDate() - offset)
  const month = String(day.getMonth() + 1).padStart(2, '0')
  return `${day.getFullYear()}-${month}-${String(day.getDate()).padStart(2, '0')}`
}

const TOTALS: Record<Period, UsageTotals> = {
  today: totals(421_260, 12_480, 96_000, 4_200, 0.0847, 12),
  '7d': totals(1_240_000, 80_000, 520_000, 18_000, 0.3912, 64),
  '30d': totals(5_120_000, 310_000, 2_040_000, 61_000, 1.234, 233),
  all: totals(14_600_000, 880_000, 5_900_000, 140_000, 3.21, 611)
}

export function sampleSummary(period: Period = 'today'): UsageSummary {
  const totalsFor = TOTALS[period]
  return {
    period,
    generatedAt: Date.now(),
    startMs: null,
    totals: totalsFor,
    today: TOTALS.today,
    days: [
      row(dayKey(0), formatDay(dayKey(0)), totals(421_260, 12_480, 96_000, 4_200, 0.0847, 12)),
      row(dayKey(1), formatDay(dayKey(1)), totals(310_000, 9_100, 64_000, 2_000, 0.0612, 9)),
      row(dayKey(3), formatDay(dayKey(3)), totals(180_000, 5_600, 41_000, 1_100, 0.0341, 6))
    ],
    projects: [
      row(
        'users-me-documents-programming-project-orca-command-code',
        '~/Documents/Programming/Project/orca-command-code',
        totals(680_000, 30_000, 280_000, 9_000, 0.2101, 41)
      ),
      row(
        'users-me-orca-workspaces-money-manager-main',
        '~/orca/workspaces/money-manager/main',
        totals(231_260, 8_000, 60_000, 3_300, 0.0623, 14)
      )
    ],
    models: [
      row('deepseek/deepseek-v4.1-flash', 'deepseek/deepseek-v4.1-flash', TOTALS.today),
      row(
        'deepseek/deepseek-v4-pro',
        'deepseek/deepseek-v4-pro',
        totals(20_000, 1_200, 8_000, 400, 0.0231, 3)
      ),
      row(
        'stealth/glyph-cluster:free',
        'stealth/glyph-cluster:free',
        totals(8_000, 500, 2_000, 100, 0, 2)
      )
    ],
    sessions: 9,
    projectsScanned: 4,
    skippedLines: 2,
    ignoredEntries: 0,
    readErrors: 0,
    dirAvailable: true,
    dirPath: '~/.commandcode/projects',
    aborted: false
  }
}

export function emptySummary(period: Period = 'today'): UsageSummary {
  return {
    period,
    generatedAt: Date.now(),
    startMs: null,
    totals: emptyTotals(),
    today: emptyTotals(),
    days: [],
    projects: [],
    models: [],
    sessions: 0,
    projectsScanned: 0,
    skippedLines: 0,
    ignoredEntries: 0,
    readErrors: 0,
    dirAvailable: true,
    dirPath: '~/.commandcode/projects',
    aborted: false
  }
}

export function missingSummary(period: Period = 'today'): UsageSummary {
  return { ...emptySummary(period), dirAvailable: false }
}
