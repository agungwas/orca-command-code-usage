// Streaming, read-only aggregation of Command Code session files.
// One JSON object per line under ~/.commandcode/projects/<slug>/<session>.jsonl.
// The verified on-disk shape lives in docs/cc-session-format.md.
import { createReadStream } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'

import { formatDay } from './format'
import { shortenHome } from './projects'
import {
  dayKey,
  emptyTotals,
  periodStart,
  type Period,
  type UsageRow,
  type UsageSummary,
  type UsageTotals
} from './shared'

export interface UsageScanOptions {
  period: Period
  /** Overrides the clock; tests use it. */
  now?: number
  /** Overrides ~/.commandcode/projects. */
  projectsDir?: string
  signal?: AbortSignal
  labelProject?: (slug: string) => string
}

interface UsageRecord {
  timestamp: number
  model: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  costUsd: number
}

export function defaultProjectsDir(): string {
  return join(homedir(), '.commandcode', 'projects')
}

export function emptySummary(
  period: Period,
  now: number,
  dirPath: string,
  dirAvailable: boolean
): UsageSummary {
  return {
    period,
    generatedAt: now,
    startMs: periodStart(period, now),
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
    dirAvailable,
    dirPath: shortenHome(dirPath),
    aborted: false
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readToken(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}

interface RecordRead {
  record: UsageRecord | null
  invalid: boolean
}

function readRecord(value: unknown): RecordRead {
  if (!isRecord(value)) return { record: null, invalid: true }
  const usage = value.usage
  // User messages, session headers, model changes and checkpoints carry no usage.
  if (usage === undefined || usage === null) return { record: null, invalid: false }
  if (!isRecord(usage)) return { record: null, invalid: true }

  const timestamp = typeof value.timestamp === 'string' ? Date.parse(value.timestamp) : Number.NaN
  if (!Number.isFinite(timestamp)) return { record: null, invalid: true }

  const model = typeof value.model === 'string' && value.model.trim() ? value.model.trim() : 'unknown'
  return {
    record: {
      timestamp,
      model,
      inputTokens: readToken(usage.inputTokens),
      outputTokens: readToken(usage.outputTokens),
      cacheReadTokens: readToken(usage.cacheReadTokens),
      cacheWriteTokens: readToken(usage.cacheWriteTokens),
      costUsd: readToken(usage.costUsd)
    },
    invalid: false
  }
}

function addRecord(totals: UsageTotals, record: UsageRecord): void {
  totals.inputTokens += record.inputTokens
  totals.outputTokens += record.outputTokens
  totals.cacheReadTokens += record.cacheReadTokens
  totals.cacheWriteTokens += record.cacheWriteTokens
  totals.totalTokens +=
    record.inputTokens + record.outputTokens + record.cacheReadTokens + record.cacheWriteTokens
  totals.costUsd += record.costUsd
  totals.messages += 1
}

function addTo(map: Map<string, UsageTotals>, key: string, record: UsageRecord): void {
  let totals = map.get(key)
  if (!totals) {
    totals = emptyTotals()
    map.set(key, totals)
  }
  addRecord(totals, record)
}

function isSessionFile(name: string): boolean {
  // *.checkpoints.jsonl holds checkpoints only and never usage.
  return name.endsWith('.jsonl') && !name.endsWith('.checkpoints.jsonl')
}

function compareRows(a: UsageRow, b: UsageRow): number {
  if (b.costUsd !== a.costUsd) return b.costUsd - a.costUsd
  if (b.totalTokens !== a.totalTokens) return b.totalTokens - a.totalTokens
  return a.key.localeCompare(b.key)
}

function toRows(map: Map<string, UsageTotals>, label: (key: string) => string): UsageRow[] {
  const rows: UsageRow[] = []
  for (const [key, totals] of map) rows.push({ key, label: label(key), ...totals })
  return rows.sort(compareRows)
}

interface FileCounts {
  skippedLines: number
  ignoredEntries: number
}

async function scanFile(
  file: string,
  onRecord: (record: UsageRecord) => void,
  counts: FileCounts
): Promise<void> {
  const stream = createReadStream(file, { encoding: 'utf8' })
  const lines = createInterface({ input: stream, crlfDelay: Infinity })
  try {
    for await (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      let parsed: unknown
      try {
        parsed = JSON.parse(trimmed)
      } catch {
        // A session can be mid-write: the last line may not be complete yet.
        counts.skippedLines += 1
        continue
      }
      const { record, invalid } = readRecord(parsed)
      if (invalid) counts.ignoredEntries += 1
      else if (record) onRecord(record)
    }
  } finally {
    lines.close()
    stream.destroy()
  }
}

/**
 * Streams every session file once and aggregates it into day, project and model groups. Never
 * throws for missing directories, unreadable files or malformed lines.
 */
export async function collectUsage(options: UsageScanOptions): Promise<UsageSummary> {
  const now = options.now ?? Date.now()
  const dirPath = options.projectsDir ?? defaultProjectsDir()
  const summary = emptySummary(options.period, now, dirPath, true)
  const startMs = summary.startMs
  const today = dayKey(now)

  let projectNames: string[]
  try {
    const entries = await readdir(dirPath, { withFileTypes: true })
    projectNames = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
  } catch {
    summary.dirAvailable = false
    return summary
  }

  const days = new Map<string, UsageTotals>()
  const projects = new Map<string, UsageTotals>()
  const models = new Map<string, UsageTotals>()
  const counts: FileCounts = { skippedLines: 0, ignoredEntries: 0 }
  const signal = options.signal

  scan: for (const slug of projectNames) {
    if (signal?.aborted) {
      summary.aborted = true
      break
    }
    let fileNames: string[]
    try {
      const entries = await readdir(join(dirPath, slug), { withFileTypes: true })
      fileNames = entries
        .filter((entry) => entry.isFile() && isSessionFile(entry.name))
        .map((entry) => entry.name)
        .sort()
    } catch {
      summary.readErrors += 1
      continue
    }
    summary.projectsScanned += 1

    for (const fileName of fileNames) {
      if (signal?.aborted) {
        summary.aborted = true
        break scan
      }
      summary.sessions += 1
      try {
        await scanFile(
          join(dirPath, slug, fileName),
          (record) => {
            if (dayKey(record.timestamp) === today) addRecord(summary.today, record)
            if (startMs !== null && record.timestamp < startMs) return
            addRecord(summary.totals, record)
            addTo(days, dayKey(record.timestamp), record)
            addTo(projects, slug, record)
            addTo(models, record.model, record)
          },
          counts
        )
      } catch {
        summary.readErrors += 1
      }
    }
  }

  const projectLabel = options.labelProject ?? ((slug: string) => slug)
  summary.days = toRows(days, formatDay)
  summary.projects = toRows(projects, projectLabel)
  summary.models = toRows(models, (model) => model)
  summary.skippedLines = counts.skippedLines
  summary.ignoredEntries = counts.ignoredEntries
  return summary
}
