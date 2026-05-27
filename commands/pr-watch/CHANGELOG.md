# Changelog

## 0.12.0 (2026-05-27)

**Feature: per-reviewer ball-in-court, merge status chips, age lifecycle, async poller**

### Ball-in-court rework

The BIC logic is now per-reviewer: each reviewer's position in the PR is evaluated independently. Previously, having one reviewer request changes would pull all other reviewers' PRs out of your court — now each reviewer's ball is tracked separately. This fixes the case where reviewer A requests changes on a PR you haven't reviewed yet, which incorrectly pulled that PR out of your (reviewer B's) court.

Fixes tracked in `ballInCourt()`:
- Draft PRs: ball goes to author only; all pending review requests are ignored
- Pending re-request after CHANGES_REQUESTED: ball goes to that reviewer, not author
- Multi-reviewer: CHANGES_REQUESTED from one reviewer doesn't affect another reviewer's BIC status
- No engagement yet: ball stays with author so they can assign reviewers

### New dashboard chips

- **🏓 Bounces chip** — counts CHANGES_REQUESTED reviews from non-author non-bots; indicates how many review round-trips a PR has had
- **Merge state chip** — `🔴 Conflict` (DIRTY), `🟠 Behind` (BEHIND), `🟢 Fresh` (CLEAN/UNSTABLE/BLOCKED/HAS_HOOKS). Hidden when UNKNOWN (GitHub computes this async and flickers after pushes)
- **Age marker** — chicken lifecycle in the card footer: 🥚 (<1h), 🐣 (1–6h), 🐥 (6h–3d), 🐔 (3–7d), 🍗 (≥7d). BIC duration inferred from review timestamps where possible

### Review chip labels

Symmetric label model — top lane says what's asked of you, bottom lane says what they're doing:
- `⚪ Reviewers needed` — author with no engagement yet  
- `🟡 Review requested` / `🟡 Re-review requested` — reviewer (first time vs. re-request)  
- `🟡 Review in progress` — reviewer, commented but not finalized  
- `🟠 Fix requested` — author, unaddressed CHANGES_REQUESTED  
- `🟢 Ready to merge` / `🟢 Author to merge` — approved  
- `🟡 Re-review pending` / `🟠 Author to fix` — waiting side labels  

The CTA chip is always first (left-aligned) in the card footer; CI/merge/bounces/age chips are right-aligned.

### Poller: async gh() calls

`gh` CLI calls are now spawn-based (async) instead of `execSync`. This keeps the Node.js event loop unblocked while polls are in flight, preventing the browser dashboard from hanging when a poll takes longer than a request timeout.

### Changed-dot placement

The blue "changed" dot now appears absolute in the top-right corner of the card, only when the PR actually changed. Cards that haven't changed reclaim that space for the title.

### Skip-enrichment optimization

PRs whose `updatedAt` matches the previous poll's value are skipped during enrichment (no `gh pr view` call). Only PRs with `mergeStateStatus: UNKNOWN` are always re-fetched (to pick up the settled value). Reduces API calls by ~90% on steady-state polls.

### Cache-Control: no-store

All dashboard static files (HTML, CSS, JS) are served with `Cache-Control: no-store` so a browser tab always loads fresh files after a poller restart.

### UNKNOWN flicker guard

`diffPr()` and the dashboard's `applyPayload()` both ignore transitions involving `UNKNOWN` for `mergeable` and `mergeStateStatus`. GitHub computes these fields asynchronously after pushes and briefly returns `UNKNOWN` before settling, which was causing spurious "changed" events.

### Pure functions promoted to lib.mjs

The following functions are now exported from `lib.mjs` (and no longer duplicated in `app.js`):
`latestMyReview`, `ballInCourt`, `bicSince`, `bouncesCount`, `ageStr`, `ageMarker`, `ciChip`, `mergeChip`, `reviewChip`, `priorityChip`

`app.js` imports them via ES module `import`. `poll.mjs` now serves `/lib.mjs` so the browser can resolve the import.

### New env vars

`mergeable` and `mergeStateStatus` are now fetched and tracked. These are included in the `VIEW_FIELDS` of `gh pr view` and appear in `current.json`. Tracked-change fields now also include `mergeable` and `mergeStateStatus` (with UNKNOWN guard).

---

## 0.11.0 (2026-05-20)

**Feature: ambient browser dashboard**

Added a local HTTP server (`http://localhost:7654` by default) that serves a live browser dashboard alongside the Claude inbox. The dashboard opens automatically on startup and stays in sync via Server-Sent Events — no polling, no page refresh.

Three new files ship with the command: `index.html`, `styles.css`, `app.js`. They must be copied to `~/.claude/pr-watch/` alongside `poll.mjs` and `lib.mjs`. The upgrade instructions in `pr-watch.md` have been updated accordingly.

Dashboard layout:
- **YOUR TURN** lane (top) — cards for PRs that need your action, shown with full title, CI chip, review state chip, and age
- **WAITING** lane (bottom) — compact rows for PRs where you're waiting on someone else
- PRs are grouped into columns by repo; right-click a column header to cycle it between default / pinned / muted
- Detects ball-in-court using the same logic as the Claude inbox (review requests, draft state, author/reviewer role)
- Extracts Linear ticket IDs from PR titles and links them to `linear.app`
- Blue dot marks PRs that changed in the latest update
- Browser tab title shows the BIC count: `(2) PR Inbox`

New env vars:
- `PR_WATCH_PORT` (default `7654`) — HTTP port for the dashboard
- `PR_WATCH_NO_DASHBOARD=1` — disable the dashboard entirely
- `PR_WATCH_NO_OPEN=1` — start the server but don't open the browser

Other changes in `poll.mjs`:
- `current.json` now has a versioned envelope: `{ schemaVersion: 1, pollerVersion, viewer, generatedAt, prs: [...] }`. The dashboard's `app.js` enforces `schemaVersion: 1` and shows a clear error if it doesn't match.
- Enrichment fallback: if `gh pr view` fails for a PR mid-session, the previous enriched state is kept rather than dropping the PR silently.
- `--reset` now writes the envelope shape to `current.json` instead of `[]`, so the dashboard can load cleanly after a reset.

## 0.9.6 (2026-05-05)

**Fix: reviewer PRs disappearing after you submit a review**

`--review-requested @me` drops a PR from search results once you submit a review, even if the PR is still open and the author hasn't acted yet. Fixed in two layers:

1. Added a `--reviewed-by @me` query so PRs you've already reviewed stay in the tracked set until they're actually closed.
2. Added a fallback: on each non-first poll, any PR in the previous state that's missing from the new search results is individually checked (`pr view ... --json state`). If it's still `OPEN`, it's re-added to the summaries and re-enriched, so it keeps tracking until truly merged or closed.

Changed `_searchUpdatedAt` to use the VIEW's `updatedAt` field (from the detailed `pr view` call) rather than the SEARCH result's `updatedAt`, since search results are no longer the source of truth for that field. Removed the search-based skip-enrichment optimization accordingly — all tracked PRs are now re-enriched on every poll.

## 0.9.3 (2026-04-21)

**Upgrade discovery**

Added version and source URL metadata to `pr-watch.md` so Claude can answer upgrade questions from any session — including the installed version, how to check for a newer one, and the exact commands to upgrade. Added source URL comment to `poll.mjs` for humans who inspect the file directly.

## 0.9.2 (2026-04-21)

**Bug fix: spurious events on day-2 startup**

When the poller was restarted with an existing `state.json` from a previous session, `isFirstRun` was computed as `false` (the state file was non-empty). The first poll would then compare current PR state against yesterday's snapshot and fire spurious `new`, `changed`, or `closed` events for things that hadn't changed since the session started.

Fix: always start with `isFirstRun = true`. The first poll now silently snapshots current state regardless of what's in `state.json`, so no events are emitted until an actual change happens after startup.

## 0.9.1 (initial)

Initial public release.
