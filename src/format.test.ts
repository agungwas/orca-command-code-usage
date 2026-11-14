import { assert, test } from 'orca/testing'

import { formatCost, formatCount, formatDay, formatTokens } from './format'

test('formats token counts compactly', () => {
  assert.equal(formatTokens(0), '0')
  assert.equal(formatTokens(999), '999')
  assert.equal(formatTokens(1_234), '1.23k')
  assert.equal(formatTokens(534_000), '534k')
  assert.equal(formatTokens(21_500_000), '21.5M')
  assert.equal(formatTokens(-4), '0')
})

test('formats exact counts with grouping', () => {
  assert.equal(formatCount(421260), (421260).toLocaleString())
  assert.equal(formatCount(Number.NaN), '0')
})

test('formats dollars with precision that fits the amount', () => {
  assert.equal(formatCost(0), '$0.00')
  assert.equal(formatCost(0.00557), '$0.0056')
  assert.equal(formatCost(0.0847), '$0.085')
  assert.equal(formatCost(3.21), '$3.21')
})

test('formats a day key, adding the year when it is not this year', () => {
  const label = formatDay('2026-11-14', new Date(2026, 10, 20))
  assert.ok(label.includes('14'))
  assert.ok(!label.includes('2026'))
  assert.ok(formatDay('2024-01-02', new Date(2026, 10, 20)).includes('2024'))
  assert.equal(formatDay('not-a-date'), 'not-a-date')
})
