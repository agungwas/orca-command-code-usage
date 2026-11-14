# Command Code Usage for Orca

An Orca plugin that surfaces token and cost usage of [Command Code](https://commandcode.ai)
sessions (`command-code` / `cmd`) inside Orca's sidebar and status bar.

Orca's built-in **Settings → Stats & usage** tracks Claude Code, Codex, OpenCode and Muse only;
Command Code sessions are recognised as a launchable agent but never scanned. This plugin fills
that gap.

## Status

Scaffolded, not implemented. See `docs/cc-session-format.md` for the verified data source.

## Target behaviour

- Sidebar panel: tokens (input / output / cache read / cache write) and estimated cost, grouped by
  day, project and model, with a period selector (today / 7 days / 30 days / all time).
- Status bar item: today's cost and token total.
- Read-only, offline. Nothing is written to `~/.commandcode` and no credential file is read.

## License

MIT
