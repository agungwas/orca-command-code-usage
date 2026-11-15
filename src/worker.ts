// The plugin's own worker: it reads Command Code sessions from disk (the panel frame cannot),
// answers the panel's requests and keeps the status bar item current.
import type { OrcaWorkerApi } from 'orca/worker'

import './protocol'
import {
  fetchCredits,
  redactSecrets,
  resolveCredential,
  type CredentialLookup,
  type FetchLike
} from './credits'
import { describeError } from './format'
import { openUsagePanel } from './open-panel'
import { createProjectLabeller } from './projects'
import {
  emptyTotals,
  normalizePeriod,
  type CreditsResult,
  type Period,
  type UsageSummary,
  type UsageTotals
} from './shared'
import { statusText, statusTone, statusTooltip } from './status'
import { collectUsage, defaultProjectsDir, emptySummary } from './usage'

const REFRESH_MS = 5 * 60_000
const CREDITS_MS = 5 * 60_000
const STATUS_TICK_MS = 60_000
const STATUS_ITEM_ID = 'command-code-today'
const SHOW_SUMMARY_COMMAND = 'command-code-usage.show-summary'

export interface PluginOptions {
  /** Tests point this at a fixture directory instead of ~/.commandcode/projects. */
  projectsDir?: string
  /** How often the status bar re-scans today; 0 disables the timer. */
  refreshMs?: number
  /** How often the credits API is polled for the status bar; 0 disables it. */
  creditsPollMs?: number
  /** How often the reset countdowns are redrawn; 0 disables it. */
  statusTickMs?: number
  /** Tests stand in for the network behind the credits block. */
  fetchImpl?: FetchLike
  /** Tests pin where a key may be found. */
  credentialLookup?: CredentialLookup
  /** Tests stand in for the CLI call that opens the panel. */
  openPanel?: () => Promise<boolean>
}

export interface PluginHandle {
  stop(): void
  summary(period: Period, signal?: AbortSignal): Promise<UsageSummary>
}

export function activateWith(orca: OrcaWorkerApi, options: PluginOptions = {}): PluginHandle {
  const projectsDir = options.projectsDir
  const refreshMs = options.refreshMs ?? REFRESH_MS
  const creditsPollMs = options.creditsPollMs ?? CREDITS_MS
  const statusTickMs = options.statusTickMs ?? STATUS_TICK_MS

  let latestToday: UsageTotals | null = null
  let latestCredits: CreditsResult = { status: 'no-key' }

  let labelProject: ((slug: string) => string) | null = null
  const labels = async (): Promise<(slug: string) => string> => {
    if (labelProject) return labelProject
    let paths: string[] = []
    try {
      const listed = await orca.host.call('workspace.list')
      paths = listed.workspaces.map((workspace) => workspace.path)
    } catch {
      // No workspace capability or no host answer: fall back to filesystem probing.
    }
    labelProject = createProjectLabeller(paths)
    return labelProject
  }

  const summary = async (period: Period, signal?: AbortSignal): Promise<UsageSummary> => {
    try {
      return await collectUsage({
        period,
        projectsDir,
        signal,
        labelProject: await labels()
      })
    } catch (error) {
      orca.log(`Command Code usage scan failed: ${describeError(error)}`)
      return emptySummary(period, Date.now(), projectsDir ?? defaultProjectsDir(), false)
    }
  }

  const readCredits = async (signal?: AbortSignal): Promise<CreditsResult> => {
    try {
      let secret: string | null = null
      try {
        secret = await orca.secrets.get('apiKey')
      } catch {
        secret = null
      }
      const credential = resolveCredential({ ...(options.credentialLookup ?? {}), secret })
      if (!credential) return { status: 'no-key' }
      if (credential.expiresAt !== undefined && credential.expiresAt <= Date.now()) {
        return { status: 'expired', expiresAt: credential.expiresAt }
      }
      return await fetchCredits({
        apiKey: credential.apiKey,
        source: credential.source,
        signal,
        ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {})
      })
    } catch (error) {
      // Never let a key or response body reach the panel unredacted.
      return { status: 'error', message: redactSecrets(describeError(error)) }
    }
  }

  const updateStatus = async (): Promise<void> => {
    const today = latestToday ?? emptyTotals()
    const now = Date.now()
    try {
      await orca.host.call('statusBar.update', {
        id: STATUS_ITEM_ID,
        text: statusText(today, latestCredits, now),
        tone: statusTone(latestCredits),
        tooltip: statusTooltip(today, latestCredits, now),
        visible: true
      })
    } catch (error) {
      orca.log(`Command Code status bar update failed: ${describeError(error)}`)
    }
  }

  const refreshUsage = async (): Promise<void> => {
    const answer = await summary('today')
    latestToday = answer.today
    await updateStatus()
  }

  const refreshCredits = async (): Promise<void> => {
    latestCredits = await readCredits()
    await updateStatus()
  }

  orca.panels.handle('usage.summary', async (input, context) => {
    const period = normalizePeriod(input?.period)
    const answer = await summary(period, context.signal)
    // Reuse the scan we already paid for: its `today` bucket is the status bar's number.
    latestToday = answer.today
    await updateStatus()
    return answer
  })

  orca.panels.handle('credits.get', async (_input, context): Promise<CreditsResult> => {
    latestCredits = await readCredits(context.signal)
    await updateStatus()
    return latestCredits
  })

  orca.commands.register(SHOW_SUMMARY_COMMAND, async () => {
    const open = options.openPanel ?? openUsagePanel
    try {
      const opened = await open()
      if (!opened) {
        orca.log(
          'Command Code: could not open the panel; no working `orca` CLI was found to run `orca plugin open`.'
        )
      }
    } catch (error) {
      orca.log(`Command Code: opening the panel failed: ${describeError(error)}`)
    }
  })

  void refreshUsage()
  if (creditsPollMs > 0) void refreshCredits()

  const usageTimer = refreshMs > 0 ? setInterval(() => void refreshUsage(), refreshMs) : null
  const creditsTimer =
    creditsPollMs > 0 ? setInterval(() => void refreshCredits(), creditsPollMs) : null
  const tickTimer =
    statusTickMs > 0 ? setInterval(() => void updateStatus(), statusTickMs) : null
  for (const timer of [usageTimer, creditsTimer, tickTimer]) {
    if (timer !== null) (timer as unknown as { unref?: () => void }).unref?.()
  }

  return {
    summary,
    stop(): void {
      if (usageTimer !== null) clearInterval(usageTimer)
      if (creditsTimer !== null) clearInterval(creditsTimer)
      if (tickTimer !== null) clearInterval(tickTimer)
    }
  }
}

let active: PluginHandle | null = null

export default function activate(orca: OrcaWorkerApi): void {
  active = activateWith(orca)
}

export function deactivate(): void {
  active?.stop()
  active = null
}
