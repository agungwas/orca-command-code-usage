// The plugin's own worker: it reads Command Code sessions from disk (the panel frame cannot),
// answers the panel's requests and keeps the status bar item current.
import type { OrcaWorkerApi } from 'orca/worker'

import './protocol'
import { describeError, formatCost, formatTokens } from './format'
import { createProjectLabeller } from './projects'
import {
  normalizePeriod,
  type Period,
  type UsageSummary,
  type UsageTotals
} from './shared'
import { collectUsage, defaultProjectsDir, emptySummary } from './usage'

const REFRESH_MS = 5 * 60_000
const STATUS_ITEM_ID = 'command-code-today'

export interface PluginOptions {
  /** Tests point this at a fixture directory instead of ~/.commandcode/projects. */
  projectsDir?: string
  /** How often the status bar re-scans today; 0 disables the timer. */
  refreshMs?: number
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
