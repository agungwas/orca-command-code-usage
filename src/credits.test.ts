import { assert, test } from 'orca/testing'

import {
  fetchCredits,
  redactSecrets,
  resolveCredential,
  type FetchLike
} from './credits'

const CREDITS = {
  credits: { monthlyCredits: 10, purchasedCredits: 5, freeCredits: 0 },
  windowLimits: {
    fiveHour: { used: 2, cap: 10, resetAt: '2026-11-14T20:00:00Z' },
    weekly: { used: 5, cap: 50, resetAt: 1_763_240_000 }
  }
}
const SUBSCRIPTION = {
  data: {
    planId: 'pro_plan',
    currentPeriodStart: '2026-11-01T00:00:00Z',
    currentPeriodEnd: '2026-12-02T00:00:00Z'
  }
}

interface Failure {
  __status: number
  body?: string
}

function isFailure(value: unknown): value is Failure {
  return typeof value === 'object' && value !== null && '__status' in value
}

function fetchWith(routes: Record<string, unknown>): FetchLike {
  return async (url) => {
    const path = new URL(url).pathname
    const value = routes[path]
    if (value === undefined) {
      return { ok: false, status: 404, statusText: 'Not Found', text: async () => 'missing', json: async () => ({}) }
    }
    if (isFailure(value)) {
      const body = value.body ?? ''
      return {
        ok: false,
        status: value.__status,
        statusText: 'error',
        text: async () => body,
        json: async () => JSON.parse(body || '{}')
      }
    }
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => JSON.stringify(value),
      json: async () => value
    }
  }
}

test('resolves a key in the pi provider order, secret first', () => {
  const fileOnly = resolveCredential({
    env: {},
    home: '/home/me',
    readFile: (path) => {
      if (path === '/home/me/.commandcode/auth.json') {
        return JSON.stringify({ commandcode: { type: 'api', key: 'file-key', expires: 4102444800000 } })
      }
      throw new Error('ENOENT')
    }
  })
  assert.equal(fileOnly?.apiKey, 'file-key')
  assert.equal(fileOnly?.expiresAt, 4102444800000)
  assert.ok(fileOnly?.source.endsWith('.commandcode/auth.json'))

  const fromEnv = resolveCredential({
    env: { COMMANDCODE_API_KEY: 'env-key' },
    readFile: () => JSON.stringify({ apiKey: 'file-key' })
  })
  assert.equal(fromEnv?.apiKey, 'env-key')
  assert.equal(fromEnv?.source, 'env COMMANDCODE_API_KEY')

  const fromSecret = resolveCredential({
    secret: 'secret-key',
    env: { COMMAND_CODE_API_KEY: 'env-key' },
    readFile: () => JSON.stringify({ apiKey: 'file-key' })
  })
  assert.equal(fromSecret?.apiKey, 'secret-key')
  assert.equal(fromSecret?.source, 'Orca secrets')
})

test('accepts the credential shapes Command Code and pi write', () => {
  const harness = (store: unknown) =>
    resolveCredential({
      env: {},
      home: '/home/me',
      readFile: () => JSON.stringify(store)
    })

  assert.equal(harness({ apiKey: 'bare' })?.apiKey, 'bare')
  assert.equal(harness({ 'command-code': 'tiny' })?.apiKey, 'tiny')
  const oauth = harness({ commandcode: { type: 'oauth', access: 'oauth-key', expires: 1_800_000_000_000 } })
  assert.equal(oauth?.apiKey, 'oauth-key')
  assert.equal(oauth?.expiresAt, 1_800_000_000_000)
  assert.equal(harness({ nope: true }), null)
})

test('reports no key rather than throwing when every store is missing', () => {
  const missing = resolveCredential({
    env: {},
    home: '/home/me',
    readFile: () => {
      throw new Error('ENOENT')
    }
  })
  assert.equal(missing, null)
})

test('redacts credential-shaped text', () => {
  const raw = [
    'Authorization: Bearer abc.def.ghi',
    'api_key=supersecretvalue',
    'user_1234567890abcdef',
    '{"access_token":"another-secret-value"}',
    'https://x.test/?token=querysecret'
  ].join(' ')
  const safe = redactSecrets(raw)
  assert.ok(!safe.includes('abc.def.ghi'))
  assert.ok(!safe.includes('supersecretvalue'))
  assert.ok(!safe.includes('1234567890abcdef'))
  assert.ok(!safe.includes('another-secret-value'))
  assert.ok(!safe.includes('querysecret'))
})

test('maps the API into plan, windows, balances and period spend', async () => {
  const result = await fetchCredits({
    apiKey: 'secret-key',
    source: 'Orca secrets',
    fetchImpl: fetchWith({
      '/alpha/whoami': { org: { login: 'acme', id: 'org-1' }, user: { userName: 'someone' } },
      '/alpha/billing/credits': CREDITS,
      '/alpha/billing/subscriptions': SUBSCRIPTION,
      '/alpha/usage/summary': { totalCost: 3.5 }
    })
  })

  assert.equal(result.status, 'ok')
  if (result.status !== 'ok') return
  assert.equal(result.account, 'acme')
  assert.equal(result.plan, 'pro plan')
  assert.equal(result.source, 'Orca secrets')
  assert.equal(result.periodSpentUsd, 3.5)
  assert.equal(result.periodEndsAt, Date.parse('2026-12-02T00:00:00Z'))
  assert.deepEqual(
    result.balances.map((balance) => [balance.label, balance.remaining]),
    [
      ['Credits', 15],
      ['Purchased', 5]
    ]
  )

  const fiveHour = result.windows.find((window) => window.id === 'fiveHour')
  assert.equal(fiveHour?.usedPct, 20)
  assert.equal(fiveHour?.used, 2)
  assert.equal(fiveHour?.cap, 10)
  assert.equal(fiveHour?.resetsAt, Date.parse('2026-11-14T20:00:00Z'))

  const weekly = result.windows.find((window) => window.id === 'weekly')
  assert.equal(weekly?.usedPct, 10)
  assert.equal(weekly?.resetsAt, 1_763_240_000 * 1000)

  const billing = result.windows.find((window) => window.id === 'billing-period')
  assert.equal(billing?.label, 'Billing · 31-day')
  assert.ok(billing?.usedPct !== null && billing!.usedPct > 18 && billing!.usedPct < 20)
})

test('omits sections the API does not report', async () => {
  const result = await fetchCredits({
    apiKey: 'k',
    source: 'env COMMAND_CODE_API_KEY',
    fetchImpl: fetchWith({
      '/alpha/whoami': { org: { login: 'acme', id: 'org-1' } },
      '/alpha/billing/credits': { __status: 500, body: 'boom' },
      '/alpha/billing/subscriptions': { __status: 500, body: 'boom' },
      '/alpha/usage/summary': { __status: 500, body: 'boom' }
    })
  })
  assert.equal(result.status, 'error')
  if (result.status !== 'error') return
  assert.ok(result.message.includes('no recognized usage data') || result.message.includes('failed'))
})

test('maps 401 to a rejected key and redacts error bodies', async () => {
  const rejected = await fetchCredits({
    apiKey: 'secret-key',
    source: 'Orca secrets',
    fetchImpl: fetchWith({ '/alpha/whoami': { __status: 401, body: '{"api_key":"supersecretvalue"}' } })
  })
  assert.equal(rejected.status, 'rejected')

  const failed = await fetchCredits({
    apiKey: 'secret-key',
    source: 'Orca secrets',
    fetchImpl: fetchWith({
      '/alpha/whoami': { __status: 500, body: 'api_key=supersecretvalue' }
    })
  })
  assert.equal(failed.status, 'error')
  if (failed.status !== 'error') return
  assert.ok(!failed.message.includes('supersecretvalue'))
})

test('times out instead of hanging the panel', async () => {
  const hanging: FetchLike = (_url, init) =>
    new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new Error('aborted')))
    })
  const result = await fetchCredits({
    apiKey: 'k',
    source: 'Orca secrets',
    fetchImpl: hanging,
    timeoutMs: 10
  })
  assert.equal(result.status, 'error')
  if (result.status !== 'error') return
  assert.ok(result.message.toLowerCase().includes('timed out'))
})
