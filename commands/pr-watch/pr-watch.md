Monitor your GitHub PR inbox by running `node ~/.claude/pr-watch/poll.mjs` as a **persistent** Monitor (persistent: true, no timeout).

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

Every output (initialized or change event) must start with a clear timestamp header on its own line, using the local wall-clock time at the moment you are responding (not the event's `ts` field, which is UTC server time). Format:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PR inbox — updated 13:10
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

Use 24h local time (HH:MM). This makes it easy to see at a glance how stale the last update is.

## On the `initialized` event

Read `~/.claude/pr-watch/current.json` and display the full current state grouped by repo, using the format above.

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
