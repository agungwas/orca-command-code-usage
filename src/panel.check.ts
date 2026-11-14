// `orca plugin check` renders the panel once per scenario with a stubbed worker answer.
import { defineCheck, hostError } from 'orca/testing'

import { emptySummary, missingSummary, sampleSummary } from './fixtures'
import type { Period } from './shared'

const answer = (input: { period: Period }) => sampleSummary(input.period)

export default defineCheck({
  populated: { requests: { 'usage.summary': answer } },
  week: { requests: { 'usage.summary': answer }, persisted: { plugin: { period: '7d' } } },
  empty: { requests: { 'usage.summary': (input) => emptySummary(input.period) } },
  missing: { requests: { 'usage.summary': (input) => missingSummary(input.period) } },
  failure: {
    requests: {
      'usage.summary': () => {
        throw hostError('action_failed', 'Command Code data is unavailable')
      }
    }
  }
})
