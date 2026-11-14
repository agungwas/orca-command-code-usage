// No build step: Orca strips the types and compiles the JSX when the panel loads.
import {
  atom,
  Callout,
  Card,
  EmptyState,
  Grid,
  Heading,
  IconButton,
  KeyValue,
  plugin,
  read,
  RelativeTime,
  Row,
  Select,
  set,
  Spinner,
  Stack,
  Tab,
  Table,
  Tabs,
  Text,
  type PanelContext,
  type TableColumn,
  type TableRow
} from 'orca'

import './protocol'
import { describeError, formatCost, formatCount, formatTokens } from './format'
import {
  isPeriod,
  PERIODS,
  type Period,
  type UsageRow,
  type UsageSummary
} from './shared'

const period = atom<Period>('period', 'today', {
  persist: 'plugin',
  version: 1,
  migrate: (stored) => (isPeriod(stored) ? stored : 'today')
})
const tab = atom('tab', 'days', { persist: 'plugin' })
const summary = atom<UsageSummary | null>(null)
const loading = atom(false)
const failure = atom<string | null>(null)

let requestSequence = 0

async function load(next: Period): Promise<void> {
  const sequence = ++requestSequence
  set(loading, true)
  set(failure, null)
  try {
    const answer = await plugin.request('usage.summary', { period: next }, { timeoutMs: 120_000 })
    if (sequence === requestSequence) set(summary, answer)
  } catch (error) {
    if (sequence === requestSequence) set(failure, describeError(error))
  } finally {
    if (sequence === requestSequence) set(loading, false)
  }
}

export function setup(_context: PanelContext): void {
  void load(read(period))
}

const COLUMNS: readonly TableColumn[] = [
  { key: 'label', label: 'Group', minWidth: 'sm' },
  { key: 'input', label: 'In', align: 'end', hideBelow: 'sm', sortable: false },
  { key: 'output', label: 'Out', align: 'end', hideBelow: 'sm', sortable: false },
  { key: 'cacheRead', label: 'Cache R', align: 'end', hideBelow: 'md', sortable: false },
  { key: 'cacheWrite', label: 'Cache W', align: 'end', hideBelow: 'md', sortable: false },
  { key: 'tokens', label: 'Tokens', align: 'end', sortable: false },
  { key: 'cost', label: 'Cost', align: 'end', sortable: false }
]

function tableRows(rows: readonly UsageRow[]): TableRow[] {
  return rows.map((row) => ({
    key: row.key,
    cells: {
      label: row.label,
      input: formatTokens(row.inputTokens),
      output: formatTokens(row.outputTokens),
      cacheRead: formatTokens(row.cacheReadTokens),
      cacheWrite: formatTokens(row.cacheWriteTokens),
      tokens: formatTokens(row.totalTokens),
      cost: formatCost(row.costUsd)
    }
  }))
}

function Totals({ data }: { data: UsageSummary }) {
  const { totals } = data
  return (
    <Stack gap="sm">
      <Grid columns={2} minItemWidth="sm" gap="sm">
        <Card title="Estimated cost">
          <Heading level={2}>{formatCost(totals.costUsd)}</Heading>
          <Text muted size="xs">
            Command Code's own per-message estimate
          </Text>
        </Card>
        <Card title="Total tokens">
          <Heading level={2}>{formatTokens(totals.totalTokens)}</Heading>
          <Text muted size="xs">{formatCount(totals.messages)} assistant messages</Text>
        </Card>
      </Grid>
      <KeyValue
        label="Token breakdown"
        items={[
          { label: 'Input', value: formatCount(totals.inputTokens), code: true },
          { label: 'Output', value: formatCount(totals.outputTokens), code: true },
          { label: 'Cache read', value: formatCount(totals.cacheReadTokens), code: true },
          { label: 'Cache write', value: formatCount(totals.cacheWriteTokens), code: true }
        ]}
      />
    </Stack>
  )
}

export default function Panel() {
  const current = read(period)
  const activeTab = read(tab)
  const data = read(summary)
  const busy = read(loading)
  const problem = read(failure)

  return (
    <Stack gap="md">
      <Row justify="between" align="center" gap="xs">
        <Heading level={2}>Command Code Usage</Heading>
        <IconButton
          icon="refresh"
          label="Refresh usage"
          tooltip="Rescan Command Code sessions"
          disabled={busy}
          onPress={() => void load(read(period))}
        />
      </Row>

      <Select
        label="Period"
        value={current}
        options={PERIODS}
        onChange={(value) => {
          const next: Period = isPeriod(value) ? value : 'today'
          set(period, next)
          void load(next)
        }}
      />

      {problem ? (
        <Callout tone="danger" title="Could not read usage" icon="warning">
          <Text size="xs">{problem}</Text>
        </Callout>
      ) : null}

      {!data ? (
        <Row gap="xs" align="center">
          <Spinner label="Reading Command Code sessions" />
          <Text muted size="xs">
            Scanning session files…
          </Text>
        </Row>
      ) : null}

      {data && !data.dirAvailable ? (
        <Callout tone="warning" title="No Command Code data" icon="info">
          <Text size="xs">
            No sessions found. Command Code writes them to {data.dirPath} when you use it.
          </Text>
        </Callout>
      ) : null}

      {data ? <Totals data={data} /> : null}

      {data && data.dirAvailable && data.totals.messages === 0 ? (
        <EmptyState
          title="No usage in this period"
          description="Try a longer period, or run a Command Code session and refresh."
          icon="bar-chart-3"
        />
      ) : null}

      {data && data.totals.messages > 0 ? (
        <Tabs label="Usage breakdown" value={activeTab} onChange={(value) => set(tab, value)}>
          <Tab value="days" label={`Day (${data.days.length})`}>
            <Table
              label="Usage by day"
              columns={COLUMNS}
              rows={tableRows(data.days)}
              emptyText="No usage"
              maxHeight="md"
            />
          </Tab>
          <Tab value="projects" label={`Project (${data.projects.length})`}>
            <Table
              label="Usage by project"
              columns={COLUMNS}
              rows={tableRows(data.projects)}
              emptyText="No usage"
              maxHeight="md"
            />
          </Tab>
          <Tab value="models" label={`Model (${data.models.length})`}>
            <Table
              label="Usage by model"
              columns={COLUMNS}
              rows={tableRows(data.models)}
              emptyText="No usage"
              maxHeight="md"
            />
          </Tab>
        </Tabs>
      ) : null}

      {data ? (
        <Stack gap="none">
          <Text muted size="xs">
            Read-only scan of {data.dirPath} · <RelativeTime at={data.generatedAt} format="short" />
          </Text>
          <Text muted size="xs">
            {data.sessions} sessions across {data.projectsScanned} projects
            {data.skippedLines > 0 ? ` · ${data.skippedLines} incomplete lines skipped` : ''}
            {data.readErrors > 0 ? ` · ${data.readErrors} unreadable files` : ''}
          </Text>
          <Text muted size="xs">
            Nothing is written to ~/.commandcode and no credentials are read.
          </Text>
        </Stack>
      ) : null}
    </Stack>
  )
}
