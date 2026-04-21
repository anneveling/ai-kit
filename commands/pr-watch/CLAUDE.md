# pr-watch — agent reference

This file is the authoritative reference for installing, configuring, and operating pr-watch programmatically. It is written for AI agents (Claude Code and others) rather than human readers.

## Files

| File | Purpose |
|---|---|
| `pr-watch.md` | Claude Code slash command — copy to `~/.claude/commands/` |
| `poll.mjs` | Node.js poller — copy to `~/.claude/pr-watch/` |
| `lib.mjs` | Pure functions used by `poll.mjs` — copy to `~/.claude/pr-watch/` |

## Maintainer workflow (repo owner / forkers only)

This section applies only when making changes to the source files in this repo.

### Making changes

1. **Create a branch** — never commit fixes or features directly to `main`. Open a PR so the change is reviewed and the diff is in the git history.
2. **Run tests** before marking the PR ready:
   ```bash
   node --test test/poll.test.mjs
   ```
   All tests must pass. If you add behaviour, add a test for it.
3. **Bump the version** — update the comment on line 2 of `poll.mjs` and the `version` field in `package.json`.
4. **Add a CHANGELOG entry** — document what changed and why in `CHANGELOG.md`.
5. **Merge the PR** to `main`.

### After merging — syncing the global install

The globally-installed copy at `~/.claude/pr-watch/` is independent of the repo. It is not updated automatically when a PR merges.

Once the PR is merged and the new version is live on `main`, ask the user (or offer to do it for them):

> "Version X.Y.Z is now on GitHub. Want me to sync your local `~/.claude/pr-watch/` install, or would you prefer to test the upgrade path yourself first?"

This is a maintainer-only step. Do not offer it to regular users of the command.

To sync:
```bash
cp poll.mjs lib.mjs ~/.claude/pr-watch/
```

## Checking for updates

The installed version is in the second line of `~/.claude/pr-watch/poll.mjs`:

```bash
head -2 ~/.claude/pr-watch/poll.mjs
# => #!/usr/bin/env node
# => // poll.mjs — version 0.9.1
```

To check if an update is available, compare that version against the second line of the raw file at:
`https://raw.githubusercontent.com/anneveling/ai-kit/main/commands/pr-watch/poll.mjs`

To update, re-run the installation steps below.

## Installation

```bash
cp pr-watch.md ~/.claude/commands/pr-watch.md
mkdir -p ~/.claude/pr-watch
cp poll.mjs lib.mjs ~/.claude/pr-watch/
```

## Invoking the command

```
/pr-watch
```

The command starts `poll.mjs` via Claude's `Monitor` tool (persistent: true, no timeout) and renders the inbox on every event.

## Running the poller directly

```bash
OWNER=your-org node ~/.claude/pr-watch/poll.mjs
OWNER=your-org POLL_INTERVAL=60 node ~/.claude/pr-watch/poll.mjs
OWNER=your-org STOP_AT=17:30 node ~/.claude/pr-watch/poll.mjs
OWNER=your-org HOURS=4 node ~/.claude/pr-watch/poll.mjs
OWNER=your-org node ~/.claude/pr-watch/poll.mjs --reset
```

## Environment variables

No env vars are required. With `gh` authenticated the poller watches all orgs the user has access to.

| Variable | Default | Description |
|---|---|---|
| `OWNER` | — | Limit to a specific GitHub org or user |
| `POLL_INTERVAL` | `120` | Seconds between polls |
| `STOP_AT` | — | Stop at a wall-clock time, e.g. `17:30` (local time) |
| `HOURS` | — | Stop after N hours, e.g. `4` |
| `STATE_DIR` | `~/.claude/pr-watch` | Directory for `state.json` and `current.json` |

Stop time precedence: `HOURS` > `STOP_AT` > default (18:00 if started 07:00–18:00, else +4h).

## Preflight checks

The script exits with a non-zero code and a human-readable message if any of the following are missing:
- Node.js 18+
- `gh` CLI in PATH
- `gh` authenticated (`gh auth status`)

## Event protocol

The poller writes one JSON object per line to stdout. Every event includes a `stopAt` field (ISO 8601, the scheduled stop time).

### `initialized`

Emitted once on first run after the initial poll completes.

```json
{ "event": "initialized", "ts": "2024-01-15T14:23:00Z", "count": 4, "stopAt": "2024-01-15T18:00:00Z" }
```

### `new`

A PR appeared that wasn't in the previous state.

```json
{ "event": "new", "ts": "...", "repo": "acme-corp/platform", "pr": 412, "title": "...", "url": "...", "role": "author", "reviewDecision": "REVIEW_REQUIRED", "isDraft": false, "ciStatus": "SUCCESS", "stopAt": "..." }
```

### `changed`

One or more tracked fields changed on an existing PR. The `changes` object contains only the fields that changed, each as `{ from, to }`.

```json
{
  "event": "changed", "ts": "...", "repo": "acme-corp/platform", "pr": 412,
  "title": "...", "url": "...", "role": "author",
  "reviewDecision": "CHANGES_REQUESTED", "isDraft": false, "ciStatus": "FAILURE",
  "changes": {
    "ciStatus": { "from": "PENDING", "to": "FAILURE" },
    "latestReviews": { "from": [...], "to": [...] }
  },
  "stopAt": "..."
}
```

Tracked change fields: `reviewDecision`, `isDraft`, `ciStatus`, `latestReviews`.

### `closed`

A PR that was in the previous state is no longer in the open PR list.

```json
{ "event": "closed", "ts": "...", "repo": "acme-corp/platform", "pr": 412, "title": "...", "url": "...", "role": "author", "stopAt": "..." }
```

### `warning`

Emitted once each at 10, 5, and 2 minutes before stop time.

```json
{ "event": "warning", "ts": "...", "minutesLeft": 10, "stopAt": "..." }
```

### `stopping`

Emitted immediately before the process exits at stop time.

```json
{ "event": "stopping", "ts": "...", "reason": "end_of_day", "stopAt": "..." }
```

## State files

| File | Description |
|---|---|
| `$STATE_DIR/state.json` | Full enriched PR data keyed by URL, used for change detection between polls |
| `$STATE_DIR/current.json` | Array of current open PRs — read this to render the inbox |

The command reads `current.json` on every event to build the display. `state.json` is internal to the poller.

## Restarting after stop

When the `stopping` event fires, restart the monitor with a new `HOURS` value:

```bash
OWNER=your-org HOURS=1 node ~/.claude/pr-watch/poll.mjs
```

## Resetting state

```bash
OWNER=your-org node ~/.claude/pr-watch/poll.mjs --reset
```

Clears both `state.json` and `current.json`. The next run treats all open PRs as a fresh first run (no change events emitted).
