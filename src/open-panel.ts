// Orca's plugin host API cannot open a panel. The one reliable way is the Orca CLI's
// `orca plugin open`, which asks the running app to show the panel. This module finds the CLI,
// resolves this plugin's key (the publisher depends on how it was installed) and calls it.
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export interface CliResult {
  stdout: string
  stderr: string
}

export type RunCli = (
  file: string,
  args: readonly string[],
  timeoutMs: number
) => Promise<CliResult>

export const runCli: RunCli = (file, args, timeoutMs) =>
  new Promise((resolve, reject) => {
    execFile(
      file,
      [...args],
      { timeout: timeoutMs, maxBuffer: 1_000_000 },
      (error, stdout, stderr) => {
        if (error) reject(error)
        else resolve({ stdout: String(stdout), stderr: String(stderr) })
      }
    )
  })

/** `orca` first (resolved from PATH), then the usual install locations. */
export function cliCandidates(
  env: Record<string, string | undefined> = process.env,
  home: string = homedir()
): string[] {
  const windows = process.platform === 'win32'
  const separator = windows ? ';' : ':'
  const names = windows ? ['orca.cmd', 'orca.exe', 'orca'] : ['orca']
  const candidates: string[] = []

  for (const directory of (env.PATH ?? '').split(separator)) {
    if (!directory) continue
    for (const name of names) candidates.push(join(directory, name))
  }
  if (!windows) {
    candidates.push(
      '/Applications/Orca.app/Contents/Resources/bin/orca',
      '/opt/homebrew/bin/orca',
      '/usr/local/bin/orca',
      join(home, '.local', 'bin', 'orca')
    )
  }

  return [...new Set(candidates)].filter((candidate) => {
    // PATH entries may be shell aliases; only hand real files to execFile.
    try {
      return existsSync(candidate)
    } catch {
      return false
    }
  })
}

interface ListedPlugin {
  pluginKey?: unknown
  name?: unknown
  status?: unknown
}

function parsePlugins(stdout: string): ListedPlugin[] {
  const parsed = JSON.parse(stdout) as { result?: { plugins?: unknown } }
  const plugins = parsed?.result?.plugins
  return Array.isArray(plugins) ? (plugins as ListedPlugin[]) : []
}

/** The first `plugin list` answer that names this plugin, preferring a running copy. */
export function pickPluginKey(plugins: readonly ListedPlugin[], name: string): string | null {
  const matches = plugins.filter(
    (plugin) =>
      plugin.name === name &&
      typeof plugin.pluginKey === 'string' &&
      plugin.pluginKey.endsWith('.command-code-usage')
  )
  const chosen =
    matches.find((plugin) => plugin.status === 'running') ??
    matches.find((plugin) => plugin.status === 'idle') ??
    matches[0]
  return typeof chosen?.pluginKey === 'string' ? chosen.pluginKey : null
}

/**
 * Opens the panel through the CLI. Returns false when no Orca CLI was found or it failed; the
 * caller logs that instead of surfacing it in the UI.
 */
export async function openUsagePanel(
  options: {
    run?: RunCli
    candidates?: readonly string[]
    pluginName?: string
    panelId?: string
  } = {}
): Promise<boolean> {
  const run = options.run ?? runCli
  const candidates = options.candidates ?? cliCandidates()
  const pluginName = options.pluginName ?? 'Command Code Usage'
  const panelId = options.panelId ?? 'command-code-usage'

  for (const file of candidates) {
    let pluginKey: string | null = null
    try {
      const listed = await run(file, ['plugin', 'list', '--json'], 10_000)
      pluginKey = pickPluginKey(parsePlugins(listed.stdout), pluginName)
    } catch {
      continue
    }
    if (!pluginKey) continue

    try {
      await run(file, ['plugin', 'open', pluginKey, '--panel', panelId, '--json'], 10_000)
      return true
    } catch {
      continue
    }
  }
  return false
}
