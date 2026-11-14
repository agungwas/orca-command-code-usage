import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { assert, test } from 'orca/testing'

import { dayKey, periodStart } from './shared'
import { collectUsage } from './usage'

// Local noon on 2026-11-14, so day grouping and period boundaries do not depend on the timezone.
const TODAY = new Date(2026, 10, 14, 12, 0, 0).getTime()
const YESTERDAY = new Date(2026, 10, 13, 12, 0, 0).getTime()
const LONG_AGO = new Date(2026, 9, 5, 12, 0, 0).getTime()

function entry(timestamp: number, model: string, usage: Record<string, number>): string {
  return JSON.stringify({ type: 'message', timestamp: new Date(timestamp).toISOString(), model, usage })
}

async function fixture(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'cc-usage-'))
  await mkdir(join(dir, 'users-me-alpha'), { recursive: true })
  await mkdir(join(dir, 'users-me-alpha-other'), { recursive: true })

  const usage = (input: number, output: number, cacheRead: number, cacheWrite: number, cost: number) => ({
    inputTokens: input,
    outputTokens: output,
    cacheReadTokens: cacheRead,
    cacheWriteTokens: cacheWrite,
    costUsd: cost
  })

  const session = [
    JSON.stringify({ type: 'session', timestamp: new Date(TODAY).toISOString() }),
    JSON.stringify({
      type: 'message',
      timestamp: new Date(TODAY).toISOString(),
      message: { role: 'user' }
    }),
    entry(TODAY, 'deepseek/deepseek-v4.1-flash', usage(100, 10, 5, 1, 0.5)),
    entry(YESTERDAY, 'deepseek/deepseek-v4-pro', usage(200, 20, 10, 2, 1.25)),
    // A session being written right now: not valid JSON yet.
    '{"type":"message","timestamp":"2026-11-14T12:00:00.000Z","usa',
    // Valid JSON, usage present, but no usable timestamp.
    JSON.stringify({ type: 'message', usage: usage(9, 9, 9, 9, 9) }),
    ''
  ].join('\n')

  // Checkpoints must be skipped entirely, even though they carry usage here.
  const checkpoints = entry(TODAY, 'ignored', usage(999, 999, 999, 999, 999))
  const older = entry(LONG_AGO, 'deepseek/deepseek-v4.1-flash', usage(300, 30, 15, 3, 2))

  await writeFile(join(dir, 'users-me-alpha', 'a.jsonl'), session)
  await writeFile(join(dir, 'users-me-alpha', 'a.checkpoints.jsonl'), checkpoints)
  await writeFile(join(dir, 'users-me-alpha-other', 'b.jsonl'), older)
  return dir
}

test('aggregates a day, project and model, skipping noise', async () => {
  const dir = await fixture()
  try {
    const summary = await collectUsage({ period: 'all', projectsDir: dir, now: TODAY })
    assert.equal(summary.dirAvailable, true)
    assert.equal(summary.sessions, 2)
    assert.equal(summary.projectsScanned, 2)
    assert.equal(summary.skippedLines, 1)
    assert.equal(summary.ignoredEntries, 1)
    assert.equal(summary.readErrors, 0)

    assert.equal(summary.totals.messages, 3)
    assert.equal(summary.totals.inputTokens, 600)
    assert.equal(summary.totals.outputTokens, 60)
    assert.equal(summary.totals.cacheReadTokens, 30)
    assert.equal(summary.totals.cacheWriteTokens, 6)
    assert.equal(summary.totals.totalTokens, 696)
    assert.equal(summary.totals.costUsd, 3.75)

    assert.equal(summary.days.length, 3)
    assert.equal(summary.projects.length, 2)
    assert.equal(
      summary.projects.find((project) => project.key === 'users-me-alpha')!.label,
      'users-me-alpha'
    )
    assert.equal(summary.models.length, 2)

    assert.equal(summary.today.messages, 1)
    assert.equal(summary.today.costUsd, 0.5)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('filters by period while keeping today separate', async () => {
  const dir = await fixture()
  try {
    const today = await collectUsage({ period: 'today', projectsDir: dir, now: TODAY })
    assert.equal(today.totals.messages, 1)
    assert.equal(today.totals.costUsd, 0.5)
    assert.equal(today.days.length, 1)
    assert.equal(today.days[0]!.key, dayKey(TODAY))

    const week = await collectUsage({ period: '7d', projectsDir: dir, now: TODAY })
    assert.equal(week.totals.messages, 2)
    assert.equal(week.totals.costUsd, 1.75)
    assert.equal(week.today.messages, 1)

    const month = await collectUsage({ period: '30d', projectsDir: dir, now: TODAY })
    assert.equal(month.totals.messages, 2)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('degrades when the projects directory is missing', async () => {
  const summary = await collectUsage({
    period: 'today',
    projectsDir: '/nonexistent/command-code-projects',
    now: TODAY
  })
  assert.equal(summary.dirAvailable, false)
  assert.equal(summary.totals.messages, 0)
  assert.deepEqual(summary.days, [])
})

test('labels projects through the supplied resolver', async () => {
  const dir = await fixture()
  try {
    const summary = await collectUsage({
      period: 'all',
      projectsDir: dir,
      now: TODAY,
      labelProject: (slug) => `~/projects/${slug}`
    })
    assert.equal(
      summary.projects.find((project) => project.key === 'users-me-alpha')!.label,
      '~/projects/users-me-alpha'
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('period starts at local midnight', () => {
  const start = periodStart('today', TODAY)!
  const date = new Date(start)
  assert.equal(date.getHours(), 0)
  assert.equal(date.getMinutes(), 0)
  assert.equal(dayKey(start), dayKey(TODAY))
  assert.equal(periodStart('all', TODAY), null)
  assert.equal(dayKey(periodStart('7d', TODAY)!), dayKey(new Date(2026, 10, 8, 0, 0, 0).getTime()))
  assert.equal(dayKey(periodStart('30d', TODAY)!), dayKey(new Date(2026, 9, 16, 0, 0, 0).getTime()))
})
