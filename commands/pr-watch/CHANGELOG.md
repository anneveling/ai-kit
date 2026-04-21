# Changelog

## 0.9.2 (2026-04-21)

**Bug fix: spurious events on day-2 startup**

When the poller was restarted with an existing `state.json` from a previous session, `isFirstRun` was computed as `false` (the state file was non-empty). The first poll would then compare current PR state against yesterday's snapshot and fire spurious `new`, `changed`, or `closed` events for things that hadn't changed since the session started.

Fix: always start with `isFirstRun = true`. The first poll now silently snapshots current state regardless of what's in `state.json`, so no events are emitted until an actual change happens after startup.

## 0.9.1 (initial)

Initial public release.
