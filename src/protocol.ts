// The panel <-> worker contract, declared once: src/panel.tsx and src/worker.ts both include it.
import type { CreditsResult, Period, UsageSummary } from './shared'

export {}

declare module 'orca' {
  interface PluginRequests {
    /** Streams ~/.commandcode once and answers the usage for `period`. */
    'usage.summary': { input: { period: Period }; output: UsageSummary }
    /** Optional, opt-in: plan, limits and credits from api.commandcode.ai. */
    'credits.get': { input: { force?: boolean }; output: CreditsResult }
  }
}
