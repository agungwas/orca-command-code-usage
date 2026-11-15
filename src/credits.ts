// Optional "Credits & limits" data from the Command Code HTTP API.
//
// This is the only networked part of the plugin and it runs only when the person enables
// `credits.enabled` (default off). Credential resolution mirrors the Paseo plugin and the pi
// Command Code provider: an Orca secret first, then COMMAND_CODE_API_KEY / COMMANDCODE_API_KEY,
// then the auth stores at ~/.commandcode, ~/.pi and ~/.omp. The key is sent only to
// api.commandcode.ai and never logged or returned to the panel; error text is redacted.
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import type { CreditsBalance, CreditsResult, CreditsWindow } from './shared'
import { shortenHome } from './projects'

const API_BASE = 'https://api.commandcode.ai'
const TIMEOUT_MS = 15_000
const ENV_KEY_NAMES = ['COMMAND_CODE_API_KEY', 'COMMANDCODE_API_KEY'] as const

export interface Credential {
  apiKey: string
  /** Epoch milliseconds when the stored login expires, when the store reports one. */
  expiresAt?: number
  /** Human-readable origin, never the key itself. */
  source: string
}

export interface CredentialLookup {
  /** The key stored in Orca's encrypted plugin secrets, if any. */
  secret?: string | null
  env?: Record<string, string | undefined>
  home?: string
  readFile?: (path: string) => string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

function apiKeyFromValue(value: unknown): { apiKey: string; expiresAt?: number } | null {
  if (typeof value === 'string') return value ? { apiKey: value } : null
  if (!isRecord(value)) return null
  const key =
    (stringValue(value.type) === 'oauth' ? stringValue(value.access) : undefined) ??
    (stringValue(value.type) === 'api' ? stringValue(value.key) : undefined) ??
    stringValue(value.access) ??
    stringValue(value.key)
  if (!key) return null
  const expires = typeof value.expires === 'number' && Number.isFinite(value.expires)
    ? value.expires
    : undefined
  return expires === undefined ? { apiKey: key } : { apiKey: key, expiresAt: expires }
}

function apiKeyFromStore(parsed: unknown): { apiKey: string; expiresAt?: number } | null {
  if (!isRecord(parsed)) return null
  return (
    apiKeyFromValue(parsed.apiKey) ??
    apiKeyFromValue(parsed.commandcode) ??
    apiKeyFromValue(parsed['command-code'])
  )
}

const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi
const CREDENTIAL_PATTERN =
  /\b(?:api[-_ ]?key|apikey|access[-_ ]?token|refresh[-_ ]?token|token|secret|password|authorization)\s*[=:]\s*[^\s,;)]+/gi
const USER_TOKEN_PATTERN = /\b(?:user|cc)_[A-Za-z0-9_-]{8,}\b/gi
const QUERY_SECRET_PATTERN =
  /([?&](?:api[-_ ]?key|apikey|access_token|refresh_token|token|secret|password)=)[^&#\s]+/gi
const STANDALONE_SECRET_PATTERN =
  /\b(?:sk|rk|ghp|github_pat|xox[baprs])[-_A-Za-z0-9]{16,}\b|\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g
const JSON_SECRET_PATTERN =
  /("\s*(?:api[-_ ]?key|apikey|access[-_ ]?token|refresh[-_ ]?token|token|secret|password|authorization)\s*"\s*:\s*")([^"]{8,})/gi

/** Removes credential-shaped material from text that may reach the UI or the logs. */
export function redactSecrets(value: string): string {
  return value
    .replace(BEARER_PATTERN, 'Bearer [redacted]')
    .replace(CREDENTIAL_PATTERN, (match) => {
      const separator = match.search(/[=:]/)
      return separator < 0 ? '[redacted]' : `${match.slice(0, separator + 1)}[redacted]`
    })
    .replace(USER_TOKEN_PATTERN, '[redacted]')
    .replace(QUERY_SECRET_PATTERN, '$1[redacted]')
    .replace(STANDALONE_SECRET_PATTERN, '[redacted]')
    .replace(JSON_SECRET_PATTERN, '$1[redacted]')
    .trim()
}

/**
 * The first store holding a key, in the pi provider's order. A key in Orca's secrets wins so the
 * person can override whatever the CLI stores without editing those files.
 */
export function resolveCredential(lookup: CredentialLookup = {}): Credential | null {
  const secret = lookup.secret?.trim()
  if (secret) return { apiKey: secret, source: 'Orca secrets' }

  const env = lookup.env ?? process.env
  for (const name of ENV_KEY_NAMES) {
    const value = env[name]?.trim()
    if (value) return { apiKey: value, source: `env ${name}` }
  }

  const home = lookup.home ?? homedir()
  const readFile = lookup.readFile ?? ((path: string) => readFileSync(path, 'utf8'))
  for (const path of [
    join(home, '.commandcode', 'auth.json'),
    join(home, '.pi', 'agent', 'auth.json'),
    join(home, '.omp', 'agent', 'auth.json')
  ]) {
    let parsed: unknown
    try {
      parsed = JSON.parse(readFile(path))
    } catch {
      continue
    }
    const found = apiKeyFromStore(parsed)
    if (found) {
      return {
        apiKey: found.apiKey,
        ...(found.expiresAt === undefined ? {} : { expiresAt: found.expiresAt }),
        source: shortenHome(path)
      }
    }
  }
  return null
}

/** A fetch implementation narrow enough to fake in tests. */
export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; signal: AbortSignal }
) => Promise<{
  ok: boolean
  status: number
  statusText: string
  text(): Promise<string>
  json(): Promise<unknown>
}>

export interface CreditsFetchOptions {
  apiKey: string
  source: string
  now?: number
  fetchImpl?: FetchLike
  signal?: AbortSignal
  timeoutMs?: number
}

interface HttpError {
  __httpError: true
  status: number
  statusText: string
  body: string
}

interface TransportError {
  __transportError: true
  timedOut: boolean
}

function isHttpError(value: unknown): value is HttpError {
  return isRecord(value) && value.__httpError === true
}

function isTransportError(value: unknown): value is TransportError {
  return isRecord(value) && value.__transportError === true
}

function parseWhoami(value: unknown): { login: string; orgId: string | null } | null {
  if (!isRecord(value)) return null
  const org = isRecord(value.org) ? value.org : undefined
  const user = isRecord(value.user) ? value.user : undefined
  const login =
    (org ? stringValue(org.login) : undefined) ??
    (user ? (stringValue(user.userName) ?? stringValue(user.name)) : undefined)
  if (!login) return null
  return { login, orgId: org ? (stringValue(org.id) ?? null) : null }
}

function normalizeTimestamp(value: unknown): number | null {
  let timestamp: number | undefined
  if (typeof value === 'number' && Number.isFinite(value)) timestamp = value
  if (typeof value === 'string' && value.trim()) {
    const text = value.trim()
    timestamp = /^\d+$/.test(text) ? Number(text) : Date.parse(text)
  }
  if (timestamp === undefined || !Number.isFinite(timestamp) || timestamp < 0) return null
  return timestamp >= 1e12 ? Math.round(timestamp) : Math.round(timestamp * 1000)
}

function timestampParam(value: unknown): string | undefined {
  const text = stringValue(value)
  if (text) return text
  const number = numberValue(value)
  return number === undefined ? undefined : String(number)
}

function usedPctOf(used: number, cap: number): number | null {
  if (!(cap > 0)) return null
  return Math.max(0, Math.min(100, (used / cap) * 100))
}

function windowFromLimits(value: unknown): CreditsWindow[] {
  if (!isRecord(value)) return []
  const windows: CreditsWindow[] = []
  for (const spec of [
    { field: 'fiveHour', id: 'fiveHour', label: '5-hour' },
    { field: 'weekly', id: 'weekly', label: 'Weekly' }
  ] as const) {
    const entry = value[spec.field]
    if (!isRecord(entry)) continue
    const used = numberValue(entry.used)
    const cap = numberValue(entry.cap)
    if (used === undefined || cap === undefined || (used === 0 && cap === 0)) continue
    windows.push({
      id: spec.id,
      label: spec.label,
      used,
      cap,
      usedPct: usedPctOf(used, cap),
      resetsAt: normalizeTimestamp(entry.resetAt)
    })
  }
  return windows
}

interface Subscription {
  planId?: string
  periodStartParam?: string
  periodEndMs: number | null
  periodSeconds: number | null
}

function parseSubscription(value: unknown): Subscription | null {
  if (!isRecord(value) || !isRecord(value.data)) return null
  const data = value.data
  const planId = stringValue(data.planId)
  const periodStartParam = timestampParam(data.currentPeriodStart)
  const endMs = normalizeTimestamp(data.currentPeriodEnd)
  const startMs = normalizeTimestamp(data.currentPeriodStart)
  if (!planId && !periodStartParam && endMs === null) return null
  return {
    ...(planId ? { planId } : {}),
    ...(periodStartParam ? { periodStartParam } : {}),
    periodEndMs: endMs,
    periodSeconds: startMs !== null && endMs !== null && endMs > startMs
      ? Math.round((endMs - startMs) / 1000)
      : null
  }
}

interface CreditBuckets {
  monthly?: number
  purchased?: number
  free?: number
}

function parseCreditBuckets(value: unknown): CreditBuckets | null {
  if (!isRecord(value) || !isRecord(value.credits)) return null
  const credits = value.credits
  const buckets: CreditBuckets = {
    ...(numberValue(credits.monthlyCredits) === undefined
      ? {}
      : { monthly: numberValue(credits.monthlyCredits) }),
    ...(numberValue(credits.purchasedCredits) === undefined
      ? {}
      : { purchased: numberValue(credits.purchasedCredits) }),
    ...(numberValue(credits.freeCredits) === undefined
      ? {}
      : { free: numberValue(credits.freeCredits) })
  }
  return buckets.monthly === undefined && buckets.purchased === undefined && buckets.free === undefined
    ? null
    : buckets
}

function remainingOf(buckets: CreditBuckets | null): number | undefined {
  if (!buckets) return undefined
  const reported = [buckets.monthly, buckets.purchased, buckets.free].filter(
    (value): value is number => value !== undefined
  )
  return reported.length ? reported.reduce((sum, value) => sum + value, 0) : undefined
}

function balancesOf(buckets: CreditBuckets | null): CreditsBalance[] {
  if (!buckets) return []
  const balances: CreditsBalance[] = []
  const remaining = remainingOf(buckets)
  if (remaining !== undefined) balances.push({ id: 'credits', label: 'Credits', remaining })
  if (buckets.purchased !== undefined && buckets.purchased > 0) {
    balances.push({ id: 'purchased', label: 'Purchased', remaining: buckets.purchased })
  }
  if (buckets.free !== undefined && buckets.free > 0) {
    balances.push({ id: 'free', label: 'Free', remaining: buckets.free })
  }
  return balances
}

function billingWindow(
  buckets: CreditBuckets | null,
  spent: number | undefined,
  subscription: Subscription | null
): CreditsWindow | null {
  const remaining = remainingOf(buckets)
  const usedPct =
    spent !== undefined && remaining !== undefined && spent + remaining > 0
      ? (spent / (spent + remaining)) * 100
      : null
  const resetsAt = subscription?.periodEndMs ?? null
  if (usedPct === null && resetsAt === null) return null
  const days =
    subscription?.periodSeconds != null ? Math.round(subscription.periodSeconds / 86_400) : null
  return {
    id: 'billing-period',
    label: days ? `Billing · ${days}-day` : 'Billing period',
    used: spent ?? null,
    cap: spent !== undefined && remaining !== undefined ? spent + remaining : null,
    usedPct,
    resetsAt
  }
}

function buildUrl(path: string, params: Record<string, string | undefined>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) if (value) search.set(key, value)
  const query = search.toString()
  return `${path}${query ? `?${query}` : ''}`
}

function failureMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return redactSecrets(message)
}

/**
 * Reads whoami, billing/credits, billing/subscriptions and usage/summary and maps them to the
 * block's shape. Sections the API does not report are omitted, never zeroed. The key is sent only
 * to api.commandcode.ai.
 */
export async function fetchCredits(options: CreditsFetchOptions): Promise<CreditsResult> {
  const now = options.now ?? Date.now()
  const fetchImpl: FetchLike = options.fetchImpl ?? (fetch as unknown as FetchLike)
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  const forwardAbort = (): void => controller.abort()
  options.signal?.addEventListener('abort', forwardAbort)

  const headers = { accept: 'application/json', Authorization: `Bearer ${options.apiKey}` }

  const request = async (path: string): Promise<unknown> => {
    if (controller.signal.aborted) throw new Error('aborted')
    try {
      const response = await fetchImpl(`${API_BASE}${path}`, {
        method: 'GET',
        headers,
        signal: controller.signal
      })
      if (!response.ok) {
        const body = await response.text().catch(() => '')
        return { __httpError: true, status: response.status, statusText: response.statusText, body }
      }
      return await response.json()
    } catch (error) {
      if (controller.signal.aborted) throw new Error('aborted')
      throw error
    }
  }

  const safeRequest = async (path: string): Promise<unknown> => {
    try {
      return await request(path)
    } catch {
      return { __transportError: true, timedOut } satisfies TransportError
    }
  }

  const httpMessage = (error: HttpError, context: string): string => {
    const detail = redactSecrets(error.body.trim()).slice(0, 200)
    return redactSecrets(
      `${context} request failed (${error.status}): ${detail || error.statusText || 'no detail'}`
    )
  }

  try {
    const whoamiRaw = await request('/alpha/whoami')
    if (isTransportError(whoamiRaw)) {
      return { status: 'error', message: 'Command Code API request timed out or could not be reached' }
    }
    if (isHttpError(whoamiRaw)) {
      if (whoamiRaw.status === 401 || whoamiRaw.status === 403) {
        return { status: 'rejected', message: 'Command Code rejected the API key' }
      }
      return { status: 'error', message: httpMessage(whoamiRaw, 'whoami') }
    }
    const account = parseWhoami(whoamiRaw)
    if (!account) {
      return { status: 'error', message: 'Command Code returned an unrecognized account response' }
    }

    const orgId = account.orgId ?? undefined
    const [creditsRaw, subscriptionRaw] = await Promise.all([
      safeRequest(buildUrl('/alpha/billing/credits', { orgId })),
      safeRequest(buildUrl('/alpha/billing/subscriptions', { orgId }))
    ])
    for (const [raw, context] of [
      [creditsRaw, 'credits'],
      [subscriptionRaw, 'subscription']
    ] as const) {
      if (isHttpError(raw) && (raw.status === 401 || raw.status === 403)) {
        return { status: 'rejected', message: `Command Code rejected the API key on the ${context} request` }
      }
    }

    const buckets = isHttpError(creditsRaw) || isTransportError(creditsRaw)
      ? null
      : parseCreditBuckets(creditsRaw)
    const subscription = isHttpError(subscriptionRaw) || isTransportError(subscriptionRaw)
      ? null
      : parseSubscription(subscriptionRaw)

    const summaryRaw = await safeRequest(
      buildUrl('/alpha/usage/summary', { orgId, since: subscription?.periodStartParam })
    )
    if (isHttpError(summaryRaw) && (summaryRaw.status === 401 || summaryRaw.status === 403)) {
      return { status: 'rejected', message: 'Command Code rejected the API key on the usage request' }
    }
    const spent = isHttpError(summaryRaw) || isTransportError(summaryRaw) || !isRecord(summaryRaw)
      ? undefined
      : numberValue(summaryRaw.totalCost)

    const windows = windowFromLimits(
      isRecord(creditsRaw) ? creditsRaw.windowLimits : undefined
    )
    const billing = billingWindow(buckets, spent, subscription)
    if (billing) windows.push(billing)
    const balances = balancesOf(buckets)
    const plan = subscription?.planId ? subscription.planId.replace(/[_-]+/g, ' ').trim() : null

    if (!buckets && !subscription && windows.length === 0) {
      return {
        status: 'error',
        message: timedOut
          ? 'Command Code quota request timed out'
          : 'Command Code returned no recognized usage data for the account'
      }
    }

    return {
      status: 'ok',
      fetchedAt: now,
      account: account.login,
      plan,
      source: options.source,
      windows,
      balances,
      periodSpentUsd: spent ?? null,
      periodEndsAt: subscription?.periodEndMs ?? null
    }
  } catch (error) {
    if (timedOut) return { status: 'error', message: 'Command Code quota request timed out' }
    if (controller.signal.aborted) return { status: 'error', message: 'Cancelled' }
    return { status: 'error', message: redactSecrets(`Failed to fetch Command Code quota: ${failureMessage(error)}`) }
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', forwardAbort)
  }
}
