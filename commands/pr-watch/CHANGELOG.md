# Changelog

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
