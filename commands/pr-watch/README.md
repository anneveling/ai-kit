# pr-watch

You're in the middle of deep work. Somewhere, a reviewer just left feedback on your PR — or CI went red — or someone's PR is waiting on you. You won't find out until you remember to check.

`pr-watch` is a Claude Code command that watches all your open pull requests and interrupts you only when something actually needs your attention. Run `/pr-watch` once and it shows you a live inbox: who's waiting on you, who you're waiting on, how long things have been stuck, and what to do next.

**The catch:** most PR monitoring tools either spam you with noise or cost tokens just to tell you nothing changed. `pr-watch` uses a different approach — a plain Node.js process does the watching in the background, entirely outside of Claude. When nothing changes, nothing happens. No polling prompts, no background inference, zero token cost. Claude only wakes up when there's actually something to render.

```
poll.mjs (Node, no tokens)          Claude
──────────────────────────          ──────────────────────────────────
polls GitHub every 2 min  ───────►  (sleeping — zero tokens)
polls GitHub every 2 min  ───────►  (sleeping — zero tokens)
CI status changed!        ───────►  wakes up, renders update, asks what to do
polls GitHub every 2 min  ───────►  (sleeping — zero tokens)
```

Auto-stops at 18:00 by default so you never accidentally leave it running overnight.

## Example output

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

If neither `STOP_AT` nor `HOURS` is set, the poller auto-stops at 18:00 if started during working hours (07:00–18:00), otherwise runs for 4 hours.

---

See [CLAUDE.md](CLAUDE.md) for the full event protocol and advanced options — useful if you're adapting this to a different agent or consuming the event stream yourself.

---

## For maintainers and forkers

> This section is only relevant if you maintain or fork this repo. If you're just using the command, stop here.

The files users install are `pr-watch.md`, `poll.mjs`, and `lib.mjs`. `CLAUDE.md`, `README.md`, `package.json`, `CHANGELOG.md`, and the `test/` directory stay in the repo and are never copied to the user's machine.

**When you change `poll.mjs` or `lib.mjs`:**

1. Bump the version comment on line 2 of `poll.mjs` and the version in `package.json`.
2. Add an entry to [CHANGELOG.md](CHANGELOG.md).
3. Re-copy to your own global install so your local copy stays in sync:
   ```bash
   cp poll.mjs lib.mjs ~/.claude/pr-watch/
   ```

The globally-installed copy at `~/.claude/pr-watch/` is independent of the repo — changes are not applied automatically.
