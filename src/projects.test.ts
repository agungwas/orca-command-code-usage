import { homedir } from 'node:os'

import { assert, test } from 'orca/testing'

import { createProjectLabeller, reconstructPath, shortenHome, slugForPath } from './projects'

test('flattens a path the way Command Code does', () => {
  assert.equal(
    slugForPath('/Users/agung.pratama/Documents/Programming/Project/orca-command-code'),
    'users-agung-pratama-documents-programming-project-orca-command-code'
  )
  assert.equal(slugForPath('/Users/me/orca/workspaces/money-manager/main'), 'users-me-orca-workspaces-money-manager-main')
})

test('reconstructs a real path from a lossy slug', () => {
  const paths = new Set([
    '/Users',
    '/Users/agung.pratama',
    '/Users/agung.pratama/Documents',
    '/Users/agung.pratama/Documents/Programming',
    '/Users/agung.pratama/Documents/Programming/Project',
    '/Users/agung.pratama/Documents/Programming/Project/orca-command-code'
  ])
  const found = reconstructPath(
    'users-agung-pratama-documents-programming-project-orca-command-code',
    (path) => paths.has(path)
  )
  assert.equal(found, '/Users/agung.pratama/Documents/Programming/Project/orca-command-code')
})

test('returns null when nothing on disk matches', () => {
  assert.equal(reconstructPath('does-not-exist-anywhere', () => false), null)
})

test('prefers a known workspace path over probing', () => {
  const label = createProjectLabeller(['/srv/repos/demo'])
  assert.equal(label('srv-repos-demo'), '/srv/repos/demo')
  assert.equal(label('unrelated-slug'), 'unrelated-slug')
})

test('shortens only the real home prefix', () => {
  const home = homedir()
  if (home) assert.equal(shortenHome(`${home}/code`), '~/code')
  assert.equal(shortenHome('/srv/repos/demo'), '/srv/repos/demo')
})
