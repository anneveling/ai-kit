<!-- version: 0.9.3 | source: https://github.com/anneveling/ai-kit/tree/main/commands/pr-watch -->

## About this command

Installed version: **0.9.3**  
Source: https://github.com/anneveling/ai-kit/tree/main/commands/pr-watch

### Checking for updates

The current installed version is on line 2 of `~/.claude/pr-watch/poll.mjs`. The latest version is on line 2 of:
`https://raw.githubusercontent.com/anneveling/ai-kit/main/commands/pr-watch/poll.mjs`

### Upgrading

If the user asks to upgrade, or if you detect a newer version is available, run:

```bash
cp ~/.claude/commands/pr-watch.md ~/.claude/commands/pr-watch.md.bak
curl -fsSL https://raw.githubusercontent.com/anneveling/ai-kit/main/commands/pr-watch/poll.mjs -o ~/.claude/pr-watch/poll.mjs
curl -fsSL https://raw.githubusercontent.com/anneveling/ai-kit/main/commands/pr-watch/lib.mjs -o ~/.claude/pr-watch/lib.mjs
curl -fsSL https://raw.githubusercontent.com/anneveling/ai-kit/main/commands/pr-watch/pr-watch.md -o ~/.claude/commands/pr-watch.md
```

---

Monitor your GitHub PR inbox by running `node ~/.claude/pr-watch/poll.mjs` as a **persistent** Monitor (persistent: true, no timeout). The script auto-stops at 18:00 local time by default. Override with `STOP_AT=17:30` or `HOURS=4` env vars prefixed to the command.

## Display format

Group PRs by repo. Use a bold header for each repo section:

**── your-org/your-repo ──────────────**

For each PR use this format:

```
🫵 [PR #N — title](url)
Role: author | CI: ✅ | Review: 🔴 CHANGES_REQUESTED
Waiting: 1d 4h ⚠️
Next: address reviewer's feedback — /review-comments N in ~/projects/your-repo
```

Ball-in-court emoji (first thing on the line, most important signal):
- 🫵 = your turn (you need to act)
- ⏳ = their turn (you are waiting on someone else)

CI emoji:
- ✅ SUCCESS, ❌ FAILURE, ⏳ PENDING/unknown

Review decision emoji:
- 🟢 APPROVED, 🔴 CHANGES_REQUESTED, 🟡 REVIEW_REQUIRED, ⚪ none

Waiting warning suffix (after the duration):
- ⚠️ if > 1 day, 🚨 if > 3 days

**Waiting time rules** (use `_searchUpdatedAt` as "last activity" fallback, `createdAt` for PR age):
- Author PR, CHANGES_REQUESTED: check the full `reviews` array (which includes your own). Find the latest CHANGES_REQUESTED review's `submittedAt`. If you have any review/comment entry with a *later* `submittedAt`, you have already responded — ball is with the reviewer: "Waiting: X (reviewer's turn — re-review requested)". If not, ball is with you: "Waiting: X (your turn)".
- Author PR, APPROVED or REVIEW_REQUIRED: "Waiting: X (reviewer's turn)" — time since `_searchUpdatedAt`
- Reviewer PR: "Waiting: X (your turn to review)" — time since `_searchUpdatedAt`

Show times as "2d 3h" or "4h 12m". Always show waiting time.

## Header

Every output must start with a timestamp header. Every event carries a `stopAt` ISO field — use it to compute remaining time and show it in the header.

Format:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PR inbox — updated 13:10  |  stops 18:00 (4h 50m left)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

When < 10 min remaining, add ⚠️:
```
PR inbox — updated 17:52  |  ⚠️ stops 18:00 (8m left)
```

Use 24h local time (HH:MM) for both the current time and the stop time. The stop time comes from the event's `stopAt` ISO field converted to local time.

## On the `initialized` event

Read `~/.claude/pr-watch/current.json` and display the full current state grouped by repo, using the format above. Mention the stop time prominently: "Monitoring until HH:MM (Xh Ym from now)."

## On the `warning` event

The poller is approaching its stop time. Show the header (which will already display the ⚠️ since < 10 min remain), then say: "Monitoring stops in ~Nm at HH:MM. Reply **"continue"** or **"2h"** to restart after it stops." Do not re-read or re-display the full PR state — keep it brief.

## On the `stopping` event

The poller has exited — no more tokens will be consumed. Show the final state with the header, note that monitoring stopped at the scheduled time, then say:

> Monitoring stopped at HH:MM. Reply **"continue"** (or a number of hours, e.g. **"2h"**) to restart. No reply needed to stay stopped.

If the user replies to continue: restart the Monitor with `HOURS=<n>` (default 1 if they just said "continue"), e.g.:
`OWNER=your-org HOURS=1 node ~/.claude/pr-watch/poll.mjs`

## On each subsequent change event (`new`, `changed`, `closed`)

Re-read `~/.claude/pr-watch/current.json` and show the updated consolidated state. After the header, note what triggered this update:
- `new`: "New PR opened: [title](url)"
- `closed`: "PR closed: [title](url)"
- `changed` with `latestReviews` in changes: "Re-review on [title](url): <reviewer> is now <state>"
- `changed` with `reviewDecision`: "Review decision changed on [title](url): <from> → <to>"
- `changed` with `ciStatus`: "CI changed on [title](url): <from> → <to>"

Then show the full state and ask what I want to do next.

## When I pick a PR to act on

Tell me:
- The working directory to open a new Claude session in (derived from the repo name in the PR data)
- The skill to run (`/review-pr N` for reviewing someone else's PR, `/review-comments N` for addressing feedback on my own PR)

Keep running until I say stop or close the session.
