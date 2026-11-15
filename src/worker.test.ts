import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { assert, mockHost, mountWorker, test } from 'orca/testing'

import type { FetchLike } from './credits'
import * as worker from './worker'

// The fixture must land on the local calendar day the worker calls "today".
const TODAY = new Date().toISOString()

function line(model: string, input: number, output: number, cost: number): string {
  return JSON.stringify({
    type: 'message',
    timestamp: TODAY,
    model,
    usage: {
      inputTokens: input,
      outputTokens: output,
      cacheReadTokens: 10,
      cacheWriteTokens: 0,
      costUsd: cost
    }
  })
}

test('answers the panel and updates the status bar from the same scan', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cc-usage-worker-'))
  try {
    await mkdir(join(dir, 'srv-repos-demo'), { recursive: true })
    await writeFile(join(dir, 'srv-repos-demo', 'session.jsonl'), `${line('m1', 100, 5, 0.25)}\n`)

    const host = mockHost({
      results: {
        'workspace.list': {
          workspaces: [
            {
              id: 'w1',
              kind: 'folder',
              name: 'demo',
              project: null,
              path: '/srv/repos/demo',
              branch: null,
              hostId: null
            }
          ],
          truncated: false
        }
      }
    })

    const mounted = await mountWorker(
      { default: (orca) => worker.activateWith(orca, { projectsDir: dir, refreshMs: 0, creditsPollMs: 0, statusTickMs: 0 }) },
      { host }
    )
    const summary = await mounted.request('usage.summary', { period: 'all' })

    assert.equal(summary.dirAvailable, true)
    assert.equal(summary.totals.messages, 1)
    assert.equal(summary.totals.totalTokens, 115)
    assert.equal(summary.totals.costUsd, 0.25)
    assert.equal(summary.projects[0]!.label, '/srv/repos/demo')

    const updates = host.callsOf('statusBar.update')
    assert.ok(updates.length >= 1)
    const last = updates[updates.length - 1] as unknown as { id: string; text: string }
    assert.equal(last.id, 'command-code-today')
    assert.equal(last.text, '⌘ $0.250 · 115')
    assert.deepEqual(mounted.refusals, [])
    await mounted.deactivate()
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('the status bar command opens the side panel', async () => {
  let opened = 0
  const host = mockHost({
    results: { 'workspace.list': { workspaces: [], truncated: false } }
  })
  const dir = await mkdtemp(join(tmpdir(), 'cc-usage-open-'))
  try {
    const mounted = await mountWorker(
      {
        default: (orca) =>
          worker.activateWith(orca, {
            projectsDir: dir,
            refreshMs: 0, creditsPollMs: 0, statusTickMs: 0,
            openPanel: async () => {
              opened += 1
              return true
            }
          })
      },
      { host }
    )

    await mounted.command('command-code-usage.show-summary')
    assert.equal(opened, 1)
    assert.equal(host.callsOf('notifications.show').length, 0)
    assert.deepEqual(mounted.refusals, [])
    await mounted.deactivate()
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('reports no-key without a request when no credential resolves', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cc-usage-credits-'))
  try {
    let fetched = false
    const host = mockHost({
      results: { 'workspace.list': { workspaces: [], truncated: false } }
    })
    const mounted = await mountWorker(
      {
        default: (orca) =>
          worker.activateWith(orca, {
            projectsDir: dir,
            refreshMs: 0, creditsPollMs: 0, statusTickMs: 0,
            credentialLookup: {
              env: {},
              home: '/nonexistent-command-code-home',
              readFile: () => {
                throw new Error('ENOENT')
              }
            },
            fetchImpl: () => {
              fetched = true
              throw new Error('should not be called')
            }
          })
      },
      { host }
    )

    assert.deepEqual(await mounted.request('credits.get', {}), { status: 'no-key' })
    assert.equal(fetched, false)
    await mounted.deactivate()
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('credits use the stored secret and never log it', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cc-usage-credits-'))
  try {
    const calls: string[] = []
    const fetchImpl: FetchLike = async (url) => {
      calls.push(new URL(url).pathname)
      const value =
        new URL(url).pathname === '/alpha/whoami'
          ? { org: { login: 'acme', id: 'org-1' } }
          : new URL(url).pathname === '/alpha/billing/credits'
            ? {
                credits: { monthlyCredits: 10 },
                windowLimits: { fiveHour: { used: 2, cap: 10, resetAt: 1_763_240_000 } }
              }
            : new URL(url).pathname === '/alpha/billing/subscriptions'
              ? { data: { planId: 'pro', currentPeriodStart: '2026-11-01T00:00:00Z', currentPeriodEnd: '2026-12-02T00:00:00Z' } }
              : { totalCost: 1 }
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () => JSON.stringify(value),
        json: async () => value
      }
    }

    const host = mockHost({
      results: { 'workspace.list': { workspaces: [], truncated: false } },
      settings: { 'credits.enabled': true },
      secrets: { apiKey: 'stored-secret-key' }
    })
    const mounted = await mountWorker(
      {
        default: (orca) =>
          worker.activateWith(orca, { projectsDir: dir, refreshMs: 0, creditsPollMs: 0, statusTickMs: 0, fetchImpl })
      },
      { host }
    )

    const result = await mounted.request('credits.get', {})
    assert.equal(result.status, 'ok')
    if (result.status !== 'ok') return
    assert.equal(result.account, 'acme')
    assert.equal(result.source, 'Orca secrets')
    assert.equal(result.balances[0]!.remaining, 10)
    assert.equal(calls.length, 4)
    assert.ok(!JSON.stringify(mounted.posts).includes('stored-secret-key'))
    assert.ok(!mounted.logs.join('\n').includes('stored-secret-key'))
    assert.deepEqual(mounted.refusals, [])
    await mounted.deactivate()
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
