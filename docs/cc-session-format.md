# Command Code session format (verified 2026-11-14)

Verified by reading live session files on this machine, Command Code 1.x.

## Location

```
~/.commandcode/
├── projects/<slug>/<session-id>.jsonl              # conversation, one JSON object per line
├── projects/<slug>/<session-id>.checkpoints.jsonl  # checkpoints only — SKIP these
├── history.jsonl                                   # cross-session history
├── sessions/                                       # session metadata
├── settings.json  config.json  auth.json           # config + credentials — NEVER read auth.json
```

`<slug>` is the project path with separators flattened, e.g.
`/Users/me/orca/workspaces/money-manager/main` →
`users-me-orca-workspaces-money-manager-main`.

## Entry shape

Each line of a non-checkpoint `.jsonl` file is one object. Top-level keys observed:

```
type          string   # e.g. "message"
timestamp     string   # ISO 8601, e.g. "2026-11-14T06:21:52.281Z"
id            string
parentId      string | null
model         string   # e.g. "deepseek/deepseek-v4.1-flash"
cwd           string
version       string
message       object   # { role, content: [...] }
usage         object   # present on assistant messages (see below)
```

### usage

```json
{
  "inputTokens": 42145,
  "outputTokens": 222,
  "cacheReadTokens": 6016,
  "cacheWriteTokens": 0,
  "costUsd": 0.005570597999999999
}
```

`costUsd` is already computed by Command Code per assistant message, so no price table is needed.
Entries without `usage` (user messages, checkpoints, tool-only records) contribute nothing.

## Aggregation notes

- Deduplicate nothing: one `usage` object per assistant message is one billable step.
- Group by `timestamp` day (local time), by `<slug>` (project), and by `model`.
- `costUsd` sums directly; token fields sum directly.
- Lines can be partially written while a session is live: skip unparsable lines silently.
- A session file may be large; stream line by line and avoid loading whole files twice.
