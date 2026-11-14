import { assert, hostError, mockHost, mount, test, type TestPanel } from 'orca/testing'

import { emptySummary, missingSummary, sampleSummary } from './fixtures'
import * as panel from './panel'
import type { Period, UsageSummary } from './shared'

let view: TestPanel | undefined

function hostFor(requests: Record<string, (input: { period: Period }) => UsageSummary>) {
  return mockHost({ requests })
}

function liveSummary(period: Period = 'today') {
  return sampleSummary(period)
}

/** Table cells, KeyValue items and EmptyState titles live in props, not text children. */
function drawn(view: TestPanel): string {
  return JSON.stringify(view.tree())
}

test('shows the totals for the selected period', async () => {
  try {
    view = await mount(panel, {
      host: hostFor({ 'usage.summary': (input) => liveSummary(input.period) })
    })
    assert.ok(view.find({ text: '$0.085' }))
    assert.ok(view.find({ text: '534k' }))
    assert.ok(drawn(view).includes('421,260'))
    assert.deepEqual(view.errors, [])
    assert.deepEqual(view.refusals, [])
  } finally {
    await view?.unmount()
    view = undefined
  }
})

test('reloads when the period changes', async () => {
  try {
    view = await mount(panel, {
      host: hostFor({ 'usage.summary': (input) => liveSummary(input.period) })
    })
    await view.select({ label: 'Period' }, 'all')
    assert.ok(view.find({ text: '$3.21' }))
    assert.ok(view.find({ text: '21.5M' }))
  } finally {
    await view?.unmount()
    view = undefined
  }
})

test('switches the breakdown table to projects', async () => {
  try {
    view = await mount(panel, {
      host: hostFor({ 'usage.summary': (input) => liveSummary(input.period) })
    })
    await view.select({ label: 'Usage breakdown' }, 'projects')
    assert.ok(drawn(view).includes('~/Documents/Programming/Project/orca-command-code'))
  } finally {
    await view?.unmount()
    view = undefined
  }
})

test('refreshes from the button', async () => {
  try {
    const host = hostFor({ 'usage.summary': (input) => liveSummary(input.period) })
    view = await mount(panel, { host })
    const before = host.callsOf('plugin.request').length
    await view.press({ label: 'Refresh usage' })
    assert.ok(host.callsOf('plugin.request').length > before)
  } finally {
    await view?.unmount()
    view = undefined
  }
})

test('shows an empty state when the period has no usage', async () => {
  try {
    view = await mount(panel, {
      host: hostFor({ 'usage.summary': (input) => emptySummary(input.period) })
    })
    assert.ok(drawn(view).includes('No usage in this period'))
  } finally {
    await view?.unmount()
    view = undefined
  }
})

test('explains a missing ~/.commandcode directory', async () => {
  try {
    view = await mount(panel, {
      host: hostFor({ 'usage.summary': (input) => missingSummary(input.period) })
    })
    assert.ok(view.find({ text: /No sessions found/ }))
  } finally {
    await view?.unmount()
    view = undefined
  }
})

test('surfaces a worker failure without throwing', async () => {
  try {
    view = await mount(panel, {
      host: hostFor({
        'usage.summary': () => {
          throw hostError('action_failed', 'Command Code data is unavailable')
        }
      })
    })
    assert.ok(view.find({ text: 'Command Code data is unavailable' }))
    assert.deepEqual(view.errors, [])
  } finally {
    await view?.unmount()
    view = undefined
  }
})
