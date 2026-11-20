# Changelog

## 0.2.0 · 2026-11-20

- Phase 2: GitHub (gh searches + views, updatedAt cache) and Linear (assigned stories, notifications, the keys PRs mention) are live. The GitHub rules follow the spec and agree with pr-watch's ball in court, apart from three intended differences (see `test/parity-pr-watch.test.ts`). Poll loop with backoff and source health; no "all quiet" while loading; done topics fold into one line. Take the helm opens Claude in the PR's clone. `--record` / `BRIDGE_REPLAY`.

## 0.1.0 · 2026-11-20

- Phase 1: skeleton with demo data. Bridge page (hot topics, split by area when they span areas; New; table by area; quiet state; source health) and topic page (briefing, log newest first with new and own events marked, Next with Make it so / Take the helm still inactive, where things stand per source, move / split, snooze, close, edit). Decisions are kept in `decisions.jsonl` and survive a restart.
