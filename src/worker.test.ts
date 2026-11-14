import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { assert, mockHost, mountWorker, test } from 'orca/testing'

import { emptyTotals } from './shared'
import * as worker from './worker'

const TODAY = new Date(2026, 10, 14, 12, 0, 0).toISOString()

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
      { default: (orca) => worker.activateWith(orca, { projectsDir: dir, refreshMs: 0 }) },
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
    assert.equal(last.text, 'CC $0.250 · 115')
    assert.deepEqual(mounted.refusals, [])
    await mounted.deactivate()
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('status text is stable for a day with no usage', () => {
  assert.equal(worker.statusText(emptyTotals()), 'CC $0.00')
})
