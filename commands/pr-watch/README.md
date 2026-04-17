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

```bash
OWNER=your-org node ~/.claude/pr-watch/poll.mjs
# or with a custom interval
OWNER=your-org POLL_INTERVAL=60 node ~/.claude/pr-watch/poll.mjs
```

## Requirements

- Node.js 18+
- `gh` CLI authenticated (`gh auth login`)
- Claude Code with slash command support
