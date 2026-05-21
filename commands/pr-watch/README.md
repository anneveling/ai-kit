# pr-watch

You're in the middle of deep work. Somewhere, a reviewer just left feedback on your PR — or CI went red — or someone's PR is waiting on you. You won't find out until you remember to check.

`pr-watch` watches all your open pull requests and surfaces changes — review decisions, CI status, who's waiting on whom — without burning tokens when nothing is happening. A plain Node.js process does the polling entirely outside of Claude.

## Two modes

### With Claude (`/pr-watch`)

Run `/pr-watch` in a Claude Code session. Claude starts the poller as a background Monitor and renders a structured inbox every time something changes: who needs your attention, what the next action is, and which skill to run (`/review-pr`, `/review-comments`). The browser dashboard also opens automatically alongside it.

```
poll.mjs (Node, no tokens)          Claude
──────────────────────────          ──────────────────────────────────
polls GitHub every 2 min  ───────►  (sleeping — zero tokens)
polls GitHub every 2 min  ───────►  (sleeping — zero tokens)
CI status changed!        ───────►  wakes up, renders update, asks what to do
polls GitHub every 2 min  ───────►  (sleeping — zero tokens)
```

### Standalone (browser dashboard only)

Run the poller directly from a terminal — no Claude session needed:

```bash
node ~/.claude/pr-watch/poll.mjs
```

The browser dashboard opens at `http://localhost:7654` and updates live via Server-Sent Events. Zero token cost. Use this for ambient monitoring while you work elsewhere — just glance at the tab when you feel like it.

---

Both modes auto-stop at 18:00 by default so you never accidentally leave a session running overnight.

## Dashboard

![pr-watch browser dashboard](docs/dashboard.png)

The browser dashboard opens automatically at `http://localhost:7654` when you start pr-watch. **YOUR TURN** (top) shows the PRs that need your action as white cards — each with the author avatar, Linear ticket link, CI status, review state, and age. **WAITING** (bottom) shows the PRs where the ball is in someone else's court as compact dark rows. Columns are grouped by repo. A blue dot marks any PR that changed in the latest poll.

The dashboard updates live via Server-Sent Events — no page refresh needed. It is purely ambient: run `/pr-watch` in Claude for the full interactive inbox, or start `node poll.mjs` standalone and just watch the browser tab.

## Example output (Claude inbox)

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PR inbox — updated 14:23  |  stops 18:00 (3h 37m left)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**── acme-corp/platform ──────────────────────**

🫵 [PR #412 — Add rate limiting to API gateway](https://github.com/acme-corp/platform/pull/412)
Role: author | CI: ✅ | Review: 🔴 CHANGES_REQUESTED
Waiting: 2d 1h 🚨
Next: address maya's feedback — /review-comments 412 in ~/projects/platform

⏳ [PR #438 — Migrate auth service to Postgres](https://github.com/acme-corp/platform/pull/438)
Role: author | CI: ⏳ | Review: 🟡 REVIEW_REQUIRED
Waiting: 4h 12m
Next: waiting for CI and reviewer

**── acme-corp/mobile-app ────────────────────**

🫵 [PR #87 — Fix crash on empty cart checkout](https://github.com/acme-corp/mobile-app/pull/87)
Role: reviewer | CI: ✅ | Review: 🟡 REVIEW_REQUIRED
Waiting: 1d 3h ⚠️
Next: review this PR — /review-pr 87 in ~/projects/mobile-app

⏳ [PR #91 — Dark mode follow-up tweaks](https://github.com/acme-corp/mobile-app/pull/91)
Role: author | CI: ✅ | Review: 🟢 APPROVED
Waiting: 52m
Next: waiting on reviewer to merge
```

When something changes, Claude wakes up and notes what triggered the update:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PR inbox — updated 14:41  |  stops 18:00 (3h 19m left)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CI changed on PR #438 — Migrate auth service to Postgres: PENDING → FAILURE

**── acme-corp/platform ──────────────────────**
...
```

## Installation

The quickest way is to tell Claude directly. Open any Claude Code session and paste:

> Install the pr-watch command from https://github.com/anneveling/ai-kit/tree/main/commands/pr-watch

Claude will read the setup instructions and copy the files into place.

For manual installation, see [CLAUDE.md](CLAUDE.md). For background on how Claude Code slash commands work, see the [Claude Code skills and commands documentation](https://code.claude.com/docs/en/slash-commands).

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

## Configuration

No configuration is required. With `gh` authenticated, `/pr-watch` works out of the box and watches all your open PRs across every org you have access to.

Optional env vars for tuning:

| Variable | Default | Description |
|---|---|---|
| `OWNER` | — | Limit to a specific GitHub org or user |
| `POLL_INTERVAL` | `120` | Seconds between polls |
| `STOP_AT` | — | Stop at a specific time today, e.g. `17:30` |
| `HOURS` | — | Stop after N hours, e.g. `4` |
| `PR_WATCH_PORT` | `7654` | HTTP port for the browser dashboard |
| `PR_WATCH_NO_DASHBOARD` | — | Set to `1` to disable the dashboard server |
| `PR_WATCH_NO_OPEN` | — | Set to `1` to start the server without opening the browser |

If neither `STOP_AT` nor `HOURS` is set, the poller auto-stops at 18:00 if started during working hours (07:00–18:00), otherwise runs for 4 hours.

---

See [CLAUDE.md](CLAUDE.md) for the full event protocol and advanced options — useful if you're adapting this to a different agent or consuming the event stream yourself.

---

## For maintainers and forkers

> This section is only relevant if you maintain or fork this repo. If you're just using the command, stop here.

The files users install are `pr-watch.md`, `poll.mjs`, `lib.mjs`, `index.html`, `styles.css`, and `app.js`. `CLAUDE.md`, `README.md`, `package.json`, `CHANGELOG.md`, and the `test/` directory stay in the repo and are never copied to the user's machine.

**When you change any of the installed files:**

1. Bump the version comment on line 2 of `poll.mjs` and the version in `package.json`.
2. Add an entry to [CHANGELOG.md](CHANGELOG.md).
3. Re-copy to your own global install so your local copy stays in sync:
   ```bash
   cp poll.mjs lib.mjs index.html styles.css app.js ~/.claude/pr-watch/
   ```

The globally-installed copy at `~/.claude/pr-watch/` is independent of the repo — changes are not applied automatically.
