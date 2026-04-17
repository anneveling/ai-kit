# pr-watch

A Claude Code command that monitors pull request status across a GitHub org. Runs a persistent background poller (`poll.mjs`) and surfaces changes — CI results, review decisions, new/closed PRs — as a live inbox.

## What's in here

| File | Purpose |
|---|---|
| `pr-watch.md` | The Claude Code slash command definition |
| `poll.mjs` | Node.js poller — watches GitHub via `gh` CLI and emits change events |

## How it works

1. `poll.mjs` runs as a persistent process, polling GitHub every N seconds
2. It writes full PR state to `~/.claude/pr-watch/current.json` and emits JSON change events to stdout
3. The slash command starts the poller via Claude's `Monitor` tool and renders the inbox in a structured format with ball-in-court indicators

## Installation

```bash
# Copy the command definition
cp pr-watch.md ~/.claude/commands/pr-watch.md

# Copy the poller script
mkdir -p ~/.claude/pr-watch
cp poll.mjs ~/.claude/pr-watch/poll.mjs
```

## Usage

```
/pr-watch
```

Run it from any Claude Code session. It will start the poller and display your current PR inbox, then update live as things change.

## Configuration

| Env var | Default | Description |
|---|---|---|
| `OWNER` | — | GitHub org/user to watch (required) |
| `POLL_INTERVAL` | `120` | Seconds between polls |
| `STOP_AT` | — | Stop at a specific clock time, e.g. `17:30` |
| `HOURS` | — | Stop after N hours, e.g. `4` |
| `STATE_DIR` | `~/.claude/pr-watch` | Where to write `state.json` and `current.json` |

If neither `STOP_AT` nor `HOURS` is set, the poller auto-stops at 18:00 if started during working hours (07:00–18:00), otherwise runs for 4 hours.

```bash
OWNER=your-org node ~/.claude/pr-watch/poll.mjs
OWNER=your-org POLL_INTERVAL=60 STOP_AT=17:30 node ~/.claude/pr-watch/poll.mjs
OWNER=your-org HOURS=2 node ~/.claude/pr-watch/poll.mjs
```

## Prerequisites

### Node.js 18+

The poller uses ESM and top-level `await`, which require Node.js 18 or later.

- Download: https://nodejs.org/en/download
- Or via a version manager like [nvm](https://github.com/nvm-sh/nvm): `nvm install 18`

Check your version: `node --version`

### GitHub CLI (`gh`)

All GitHub API calls go through the `gh` CLI — there are no npm dependencies.

- Install: https://cli.github.com — covers Mac (Homebrew), Linux, and Windows
- After installing, authenticate: `gh auth login`

Check it works: `gh auth status`

### Claude Code

The slash command (`pr-watch.md`) requires [Claude Code](https://claude.ai/code) with slash command support.

The poller script (`poll.mjs`) can also be run standalone without Claude Code if you want to consume the JSON event stream yourself.

---

The script validates all of the above at startup and exits with a clear message if anything is missing.
