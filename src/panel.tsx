// No build step: Orca strips the types and compiles the JSX when the panel loads.
import {
  atom,
  Badge,
  Button,
  Callout,
  Card,
  EmptyState,
  Grid,
  Heading,
  IconButton,
  Input,
  KeyValue,
  plugin,
  Progress,
  read,
  RelativeTime,
  Row,
  secrets,
  Select,
  set,
  settings,
  Spinner,
  Stack,
  Switch,
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
  type CreditsResult,
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

const creditsEnabled = atom(false)
const credits = atom<CreditsResult | null>(null)
const creditsBusy = atom(false)
const creditsKey = atom('')

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
  void settings
    .get('credits.enabled')
    .then((value) => {
      const enabled = value === true
      set(creditsEnabled, enabled)
      if (enabled) void loadCredits()
      else set(credits, { status: 'disabled' })
    })
    .catch(() => set(credits, { status: 'disabled' }))
}

async function loadCredits(): Promise<void> {
  if (!read(creditsEnabled)) {
    set(credits, { status: 'disabled' })
    return
  }
  set(creditsBusy, true)
  try {
    set(credits, await plugin.request('credits.get', {}, { timeoutMs: 30_000 }))
  } catch (error) {
    set(credits, { status: 'error', message: describeError(error) })
  } finally {
    set(creditsBusy, false)
  }
}

async function setCreditsEnabled(enabled: boolean): Promise<void> {
  set(creditsEnabled, enabled)
  try {
    await settings.set('credits.enabled', enabled)
  } catch (error) {
    set(credits, { status: 'error', message: describeError(error) })
    return
  }
  if (enabled) void loadCredits()
  else set(credits, { status: 'disabled' })
}

async function saveCreditsKey(): Promise<void> {
  const key = read(creditsKey).trim()
  if (!key) return
  set(creditsBusy, true)
  try {
    await secrets.set('apiKey', key)
    set(creditsKey, '')
    await loadCredits()
  } catch (error) {
    set(credits, { status: 'error', message: describeError(error) })
  } finally {
    set(creditsBusy, false)
  }
}

async function clearCreditsKey(): Promise<void> {
  set(creditsBusy, true)
  try {
    await secrets.delete('apiKey')
    await loadCredits()
  } catch (error) {
    set(credits, { status: 'error', message: describeError(error) })
  } finally {
    set(creditsBusy, false)
  }
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

function CreditsBody({ report, busy }: { report: CreditsResult; busy: boolean }) {
  if (report.status === 'disabled') return null

  if (report.status === 'no-key' || report.status === 'expired') {
    const draft = read(creditsKey)
    return (
      <Stack gap="xs">
        {report.status === 'expired' ? (
          <Callout tone="warning" title="Command Code login expired" icon="warning">
            <Text size="xs">
              Save a fresh API key, or sign in again with the Command Code CLI.
            </Text>
          </Callout>
        ) : (
          <Text muted size="xs">
            No API key found. Paste one here, set COMMAND_CODE_API_KEY, or sign in with the Command
            Code CLI (~/.commandcode/auth.json).
          </Text>
        )}
        <Input
          label="Command Code API key"
          type="password"
          value={draft}
          placeholder="cc_…"
          onChange={(value) => set(creditsKey, value)}
        />
        <Row gap="xs">
          <Button size="sm" disabled={!draft.trim() || busy} onPress={() => void saveCreditsKey()}>
            Save key
          </Button>
        </Row>
      </Stack>
    )
  }

  if (report.status === 'rejected') {
    return (
      <Callout tone="danger" title="API key rejected" icon="warning">
        <Text size="xs">{report.message}. Check the key or sign in again with the CLI.</Text>
      </Callout>
    )
  }

  if (report.status === 'error') {
    return (
      <Callout tone="warning" title="Credits unavailable" icon="info">
        <Text size="xs">{report.message}</Text>
      </Callout>
    )
  }

  return (
    <Stack gap="sm">
      <Row justify="between" align="center" gap="xs" wrap>
        <Row gap="xs" align="center">
          {report.plan ? <Badge tone="accent">{report.plan}</Badge> : null}
          <Text size="xs" muted>
            {report.account ?? 'Command Code'}
          </Text>
        </Row>
        <Button
          variant="ghost"
          size="sm"
          icon="refresh"
          disabled={busy}
          onPress={() => void loadCredits()}
        >
          Refresh
        </Button>
      </Row>

      {report.windows.map((window) => (
        <Stack gap="xs" key={window.id}>
          <Progress
            label={`${window.label}${window.usedPct === null ? '' : ` · ${Math.round(window.usedPct)}%`}`}
            value={window.usedPct ?? 0}
          />
          <Text muted size="xs">
            {window.used !== null && window.cap !== null
              ? `${formatCost(window.used)} of ${formatCost(window.cap)}`
              : 'No cap reported'}
            {window.resetsAt !== null ? ' · resets ' : ''}
            {window.resetsAt !== null ? (
              <RelativeTime at={window.resetsAt} format="short" />
            ) : null}
          </Text>
        </Stack>
      ))}

      {report.balances.length > 0 ? (
        <KeyValue
          label="Balances"
          items={report.balances.map((balance) => ({
            label: balance.label,
            value: formatCost(balance.remaining),
            code: true
          }))}
        />
      ) : null}

      {report.periodSpentUsd !== null ? (
        <Text size="xs">Spent this billing period: {formatCost(report.periodSpentUsd)}</Text>
      ) : null}

      <Row justify="between" align="center" gap="xs" wrap>
        <Text muted size="xs">
          {report.source} · <RelativeTime at={report.fetchedAt} format="short" />
        </Text>
        {report.source === 'Orca secrets' ? (
          <Button variant="ghost" size="sm" disabled={busy} onPress={() => void clearCreditsKey()}>
            Forget key
          </Button>
        ) : null}
      </Row>
    </Stack>
  )
}

function CreditsSection() {
  const enabled = read(creditsEnabled)
  const report = read(credits)
  const busy = read(creditsBusy)
  return (
    <Card title="Credits & limits" description="Optional · Command Code API">
      <Stack gap="sm">
        <Switch
          label="Query api.commandcode.ai"
          checked={enabled}
          onChange={(value) => void setCreditsEnabled(value)}
        />
        <Text muted size="xs">
          {enabled
            ? 'Reads a Command Code API key and sends it only to api.commandcode.ai.'
            : 'Off by default: no network request and no credential file is read.'}
        </Text>
        {enabled && busy && !report ? <Spinner label="Loading Command Code credits" /> : null}
        {enabled && report ? <CreditsBody report={report} busy={busy} /> : null}
      </Stack>
    </Card>
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

      {data ? <CreditsSection /> : null}

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
            The usage scan writes nothing to ~/.commandcode and reads no credential file.
          </Text>
        </Stack>
      ) : null}
    </Stack>
  )
}
