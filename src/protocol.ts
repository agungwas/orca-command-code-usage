// The panel <-> worker contract, declared once: src/panel.tsx and src/worker.ts both include it.
import type { Period, UsageSummary } from './shared'

export {}

declare module 'orca' {
  interface PluginRequests {
    /** Streams ~/.commandcode once and answers the usage for `period`. */
    'usage.summary': { input: { period: Period }; output: UsageSummary }
  }
}
