// `orca plugin check` renders the panel once per scenario with stubbed worker answers.
import { defineCheck, hostError } from 'orca/testing'

import {
  creditsNoKey,
  emptySummary,
  missingSummary,
  sampleCredits,
  sampleSummary
} from './fixtures'
import type { CreditsResult, Period, UsageSummary } from './shared'

type UsageAnswer = (input: { period: Period }) => UsageSummary

const answer: UsageAnswer = (input) => sampleSummary(input.period)

const requests = (usage: UsageAnswer = answer, credits: CreditsResult = sampleCredits()) => ({
  'usage.summary': usage,
  'credits.get': credits
})

export default defineCheck({
  populated: { requests: requests() },
  week: { requests: requests(), persisted: { plugin: { period: '7d' } } },
  noKey: { requests: requests(answer, creditsNoKey()) },
  empty: { requests: requests((input) => emptySummary(input.period)) },
  missing: { requests: requests((input) => missingSummary(input.period)) },
  failure: {
    requests: requests(() => {
      throw hostError('action_failed', 'Command Code data is unavailable')
    })
  }
})
