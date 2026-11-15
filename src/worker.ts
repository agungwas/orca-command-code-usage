// The plugin's own worker: it reads Command Code sessions from disk (the panel frame cannot),
// answers the panel's requests and keeps the status bar item current.
import type { OrcaWorkerApi } from 'orca/worker'

import './protocol'
import { fetchCredits, redactSecrets, resolveCredential, type CredentialLookup, type FetchLike } from './credits'
import { describeError, formatCost, formatTokens } from './format'
import { openUsagePanel } from './open-panel'
import { createProjectLabeller } from './projects'
import {
  normalizePeriod,
  type CreditsResult,
  type Period,
  type UsageSummary,
  type UsageTotals
} from './shared'
import { collectUsage, defaultProjectsDir, emptySummary } from './usage'

const REFRESH_MS = 5 * 60_000
const STATUS_ITEM_ID = 'command-code-today'
const SHOW_SUMMARY_COMMAND = 'command-code-usage.show-summary'

export interface PluginOptions {
  /** Tests point this at a fixture directory instead of ~/.commandcode/projects. */
  projectsDir?: string
  /** How often the status bar re-scans today; 0 disables the timer. */
  refreshMs?: number
  /** Tests stand in for the network behind the credits block. */
  fetchImpl?: FetchLike
  /** Tests pin where a key may be found. */
  credentialLookup?: CredentialLookup
  /** Tests stand in for the CLI call that opens the panel. */
  openPanel?: () => Promise<boolean>
}

export function statusText(today: UsageTotals): string {
  if (today.messages === 0) return 'CC $0.00'
  return `CC ${formatCost(today.costUsd)} · ${formatTokens(today.totalTokens)}`
}

export function statusTooltip(today: UsageTotals): string {
  return `Command Code today: ${formatTokens(today.totalTokens)} tokens, ${formatCost(
    today.costUsd
  )} estimated across ${today.messages} messages`
}

export interface PluginHandle {
  stop(): void
  summary(period: Period, signal?: AbortSignal): Promise<UsageSummary>
}

export function activateWith(orca: OrcaWorkerApi, options: PluginOptions = {}): PluginHandle {
  const projectsDir = options.projectsDir
  const refreshMs = options.refreshMs ?? REFRESH_MS

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

  const updateStatus = async (today: UsageTotals): Promise<void> => {
    try {
      await orca.host.call('statusBar.update', {
        id: STATUS_ITEM_ID,
        text: statusText(today),
        tone: 'neutral',
        tooltip: statusTooltip(today),
        visible: true
      })
    } catch (error) {
      orca.log(`Command Code status bar update failed: ${describeError(error)}`)
    }
  }

  orca.panels.handle('usage.summary', async (input, context) => {
    const period = normalizePeriod(input?.period)
    const answer = await summary(period, context.signal)
    // Reuse the scan we already paid for: its `today` bucket is the status bar's number.
    await updateStatus(answer.today)
    return answer
  })

  orca.panels.handle('credits.get', async (_input, context): Promise<CreditsResult> => {
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
        signal: context.signal,
        ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {})
      })
    } catch (error) {
      // Never let a key or response body reach the panel unredacted.
      return { status: 'error', message: redactSecrets(describeError(error)) }
    }
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

  const refreshStatus = async (): Promise<void> => {
    const today = await summary('today')
    await updateStatus(today.today)
  }

  void refreshStatus()

  const timer = refreshMs > 0 ? setInterval(() => void refreshStatus(), refreshMs) : null
  if (timer !== null) (timer as unknown as { unref?: () => void }).unref?.()

  return {
    summary,
    stop(): void {
      if (timer !== null) clearInterval(timer)
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
