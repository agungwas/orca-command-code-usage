import { assert, test } from 'orca/testing'

import { openUsagePanel, pickPluginKey, type RunCli } from './open-panel'

const LIST = JSON.stringify({
  ok: true,
  result: {
    plugins: [
      { pluginKey: 'other.plugin', name: 'Other', status: 'running' },
      { pluginKey: 'local.command-code-usage', name: 'Command Code Usage', status: 'idle' },
      { pluginKey: 'acme.command-code-usage', name: 'Command Code Usage', status: 'running' }
    ]
  }
})

function fakeRun(
  handler: (file: string, args: readonly string[]) => string | Error
): RunCli {
  const calls: { file: string; args: readonly string[] }[] = []
  const run: RunCli = async (file, args) => {
    calls.push({ file, args })
    const result = handler(file, args)
    if (result instanceof Error) throw result
    return { stdout: result, stderr: '' }
  }
  return Object.assign(run, { calls })
}

test('prefers a running copy of the plugin', () => {
  const plugins = JSON.parse(LIST).result.plugins
  assert.equal(pickPluginKey(plugins, 'Command Code Usage'), 'acme.command-code-usage')
  assert.equal(pickPluginKey([{ pluginKey: 'x.other', name: 'Other' }], 'Command Code Usage'), null)
})

test('opens the panel through the CLI', async () => {
  const run = fakeRun((_file, args) => {
    if (args[1] === 'list') return LIST
    return '{"ok":true}'
  }) as RunCli & { calls: { file: string; args: readonly string[] }[] }

  const opened = await openUsagePanel({ run, candidates: ['/fake/orca'] })
  assert.equal(opened, true)
  assert.equal(run.calls.length, 2)
  assert.deepEqual(run.calls[0]!.args.slice(0, 3), ['plugin', 'list', '--json'])
  assert.deepEqual(run.calls[1]!.args.slice(0, 3), [
    'plugin',
    'open',
    'acme.command-code-usage'
  ])
  assert.deepEqual(run.calls[1]!.args.slice(3), ['--panel', 'command-code-usage', '--json'])
})

test('falls through to the next CLI candidate', async () => {
  const run = fakeRun((file, args) => {
    if (file === '/broken/orca') return new Error('ENOENT')
    if (args[1] === 'list') return LIST
    return '{"ok":true}'
  })

  const opened = await openUsagePanel({ run, candidates: ['/broken/orca', '/good/orca'] })
  assert.equal(opened, true)
})

test('reports false when the plugin is not listed', async () => {
  const run = fakeRun(() => JSON.stringify({ ok: true, result: { plugins: [] } }))
  assert.equal(await openUsagePanel({ run, candidates: ['/fake/orca'] }), false)
})

test('reports false with no CLI at all', async () => {
  assert.equal(await openUsagePanel({ candidates: [] }), false)
})
