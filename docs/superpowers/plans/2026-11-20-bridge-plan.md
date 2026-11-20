# Bridge: plan

*2026-11-20 · Spec: [2026-11-20-bridge-design.md](../specs/2026-11-20-bridge-design.md) · Branch: `bridge` · Reshaped on 2026-11-20, after phases 1–2 ran on real data*

**Goal:** bridge is my life helper: one page that shows what I need to do, answer or keep an eye on, at work and outside it, and that I open every day. It polls the sources by code, groups everything into topics I think in, and says who has the ball. Claude helps on a topic when asked.

## Why the plan changed

The first plan was a build list in six phases. Phases 1 and 2 are built and work (see *Done so far*). Running them on real data, and a second look at the goal, changed four things:

- **A topic was too small.** One topic per Linear story gave 53 topics in 14 days, 35 of them stories of one project. Merging them by hand, at about three new stories a day, is a chore that would kill daily use. Now: one topic per Linear project by default, and I pull a story or a few out when I want them on their own.
- **Sorting has to stick.** 8 open PRs had no story key and landed in New; 6 of them shared one title prefix. Now: when I sort something, bridge asks once whether that always holds.
- **Two buttons everywhere was noise.** Now: one **Take the helm** per topic. **Make it so** only next to a step Claude suggested. Everything else is a plain link to the thing.
- **Use comes before more building.** I couldn't run bridge myself until the very end (the install step came after phase 6). Now it's the first step, and a week of real use steers what comes after. The part with the most machinery and the least proven need, Claude fixing code in the background, moves last.

## The steps

Each step ends in something I can use. The technical tasks are under each step.

| Step | After it I can | Adds |
|---|---|---|
| **A. Mine to run** | Open bridge every morning. It starts at login and keeps my own decisions | A start-at-login entry |
| **B. Topics I think in, calmer pages** | See a whole project as one topic; sort a thing once; see only what needs me or is moving | A sorting rule (one new kind of decision) |
| **C. Slack** | Stop opening Slack to check what I missed | The Slack source and the cheap model check |
| **D. A week of use** | Know what's missing, from use and not from guessing | Nothing |
| **E. Life: GTD and calendar** | See my tasks and my day next to work | One endpoint and one scheduled Claude run (if the spike holds) |
| **F. Claude on a topic** | Get the next step suggested when I open a topic, ask about it, and hand over small steps | Suggestions, Ask Claude, jobs without code |
| **G. Make it so for code** | Hand over "fix CI" and get a commit to approve | The officer with worktrees |

### A. Mine to run

Today `npm start` fails in my shell (my default Node is 20.19; bridge needs 22.18+) and the only running copy is a test copy.

| # | Task | Done when |
|---|---|---|
| A.1 | `scripts/install.sh`: copy `src/`, `web/`, `demo/` and `package.json` to `~/.claude/bridge/app/`; find a Node ≥ 22.18 and remember its path; print what it did. Like pr-watch's `sync-global.sh`. | The installed copy starts with one command |
| A.2 | Start at login: a LaunchAgent (`~/Library/LaunchAgents/…bridge.plist`) that runs the installed copy with `--no-open` and restarts it if it stops. The script writes it; **I run the script myself**, since it's a standing change to my machine. `install.sh --remove` takes it away. | After a reboot, `http://127.0.0.1:7766/` shows my real data |
| A.3 | A PR for phases 1–2 from `bridge` (assign me), so the work is safe and reviewable at a readable size. Later steps get their own PRs. | PR open, CI green |
| A.4 | One day next to pr-watch (the phase 2 check that was still mine). | Every YOUR TURN in pr-watch is my move in bridge, or the difference is one of the three intended ones |

**Done check:** I opened bridge three mornings in a row without starting anything.

### B. Topics I think in, calmer pages, the new buttons

| # | Task | Tests first | Done when |
|---|---|---|---|
| B.1 | **Topic per project.** A story's Linear project gives the topic (`project:<slug>`); a PR, thread or task follows its story. A story without a project keeps its own topic. Nothing to go on → New. | Story with and without project; a PR follows its story; my earlier decisions still apply | The biggest project is one topic |
| B.2 | **Pull stories out.** On a story line: "own topic" or "belongs to…", for one story or a few. Its PRs and threads come along, now and later. Uses the decisions that exist (`new_topic`, `merge`), no new kind. | One story out; two stories into one topic; a later PR follows | Works on a real story |
| B.3 | **Sort once, it sticks.** A new decision, `rule`: match on title prefix, repo, Slack channel or person → topic. When I sort an item, bridge offers the best guess ("always: titles starting with RELEASE-RUN") and I can say no. Order: my move of one item > a story I placed > a rule > the project > the story > New. | One case per kind of match; the order | New is empty after two sorts on today's data |
| B.4 | **A calmer bridge.** The table shows only topics that need me, are moving, or wait on someone. Quiet ones fold into "N quiet", next to "N done"; both open on a click. | View cases | No quiet rows on the real page |
| B.5 | **Topic page.** Stories grouped by milestone under *where things stand*. One **Take the helm** in the header: it opens Claude in the clone of the thing that most needs me (a topic without a repo opens in a folder from config). *Needs you*: one line per thing with a link to it, and dismiss. The button pairs per item and the Tell Claude box go; *Claude suggests* and *Ask Claude* appear in step F, with nothing dead on the page until then. | View cases; screenshots | Matches the drawing agreed on 2026-11-20 |
| B.6 | Demo data, screenshots, README and spec follow the new shape. | Screenshot script | Regenerated |

**Done check:** on my real data the bridge fits on one screen, and every row on it is something I'd want to know.

### C. Slack

The token is in and the limits are measured (spike 0.5). A poll is three searches (mentions of me, my own messages, DMs) for what's new, plus the threads that moved.

| # | Task | Tests first | Done when |
|---|---|---|---|
| C.1 | `sources/slack.ts`: DMs, mentions, threads I posted in; people matched by email. Backs off when Slack says so. | Contract test on made-up responses | Items and events from fixtures |
| C.2 | `rules/slack.ts`: a DM whose last message isn't mine, or a mention I haven't answered → me, reply. My question with no answer → them, nudge after 24h. Anything else → the check decides. | One case per row of the spec's table | Tests green |
| C.3 | `classify.ts`, the Slack check: "is this asking me something?" through `claude -p --model haiku`, once per message, cached. If it fails, the message counts as "maybe for you". Channels or DMs named in config are never sent to the model. | Fake claude: yes / no / garbage / timeout; the skip list | Tests green |
| C.4 | Where a thread lands: a story key or PR link in it → that topic; a sorting rule (channel, person) → that topic; else New, with Sort and "always". | Cases | Tests green |
| C.5 | The same check on Linear mentions, so a real question there can turn red (today they're yellow at most). | Cases | Tests green |

**Done check:** for two days I don't open Slack to check for something I missed. Every miss gets noted (step D).

### D. A week of use

No building. I use bridge; misses and wishes go into *Found in use* at the end of this plan (I can tell Claude in any session: "bridge note: …"). At the end: the spec's success check (do I still go round the sources? how often is the next step wrong?), and I reorder E–G from that list.

### E. Life: GTD and calendar

The idea: fast sources stay code (GitHub, Linear, Slack need minutes). Slow life sources come through Claude's own connectors: a few times a day a scheduled Claude run reads my GTD tasks and calendar and posts them to bridge. A new life source is then a paragraph of instructions, not a token, an app and a source file. It costs tokens per run, and items can be hours old.

| # | Task | Tests first | Done when |
|---|---|---|---|
| E.0 | **Spike.** A scheduled task in the Claude desktop app that reads Notion GTD (next actions, waiting-fors) and today's calendar through the connectors and posts JSON to bridge on this laptop. Find out: can it reach bridge, what does one run cost, does it run when the laptop was asleep. | (spike) | A go or no-go, written here |
| E.1 | `POST /items`: a named source ("gtd", "calendar") replaces its own items. Checked against a schema; local only. | Good and bad payloads; one source never touches another's items | Tests green |
| E.2 | Rules: a task due today or overdue → me, do (overdue is red). A waiting-for → them, nudge on its date. A calendar event is never "my move"; it shows in Today. | Cases | Tests green |
| E.3 | **Today** on the bridge: one line with today's events and the tasks due today. | View cases | On the real page |
| E.4 | Tasks land in topics by a sorting rule (GTD area or project → topic) or a story key in the title; else New. | Cases | Tests green |

**If the spike says no:** Notion by code (the integration token from 0.3, `sources/notion.ts`); calendar waits, because Google's sign-in by code is a project of its own.

**Done check:** my overdue tax task and today's meetings are on the bridge without me doing anything.

### F. Claude on a topic

The free, rule-made lines under *Needs you* ("Review #235 for Toby") are always there. This step adds Claude's own view.

| # | Task | Tests first | Done when |
|---|---|---|---|
| F.1 | The context pack per topic: briefing, items, recent log, capped in size. | Pack from fixtures; the cap | Tests green |
| F.2 | **Claude suggests.** When I open a topic that's my move, bridge asks Claude once for one to three next steps: what, why, and whether Claude could do it. Kept until the topic changes; never for quiet topics; nothing runs for topics I don't open. A switch in config turns it to "only when I ask". | Fake claude; kept until a change; not for quiet topics | Opening a hot topic shows a sensible first step |
| F.3 | **Ask Claude**, one box per topic: my question → an answer and, where it fits, suggested steps. Replaces the planned draft, deeper briefing and Tell Claude. | Fake claude | Works on a real topic |
| F.4 | **Make it so**, next to a suggested step Claude can do without code: draft a reply or a nudge (I get "Copy + open thread"), add or finish a GTD task. Bridge still sends nothing itself. | Fake claude: working → done / needs you | A real draft, copied into a real thread |
| F.5 | Promises: when the Slack check sees I promised something, the topic suggests a GTD task; Make it so adds it. | From a fixture message; nothing written without my OK | A real task after OK |
| F.6 | Jobs are kept in `jobs.jsonl`, so a restart doesn't lose a draft in progress. | Restart cases | Tests green |

**Done check:** in a week I used Make it so at least a few times and the drafts needed little editing. If not, G waits.

### G. Make it so for code (the officer)

Only if D and F show I want it. The spike passed (see *Officer spike results*).

| # | Task | Tests first | Done when |
|---|---|---|---|
| G.1 | A code job: a git worktree of the repo, a fixed session id, the suggested step plus the context pack, "never push, send, merge or close", and a status line at the end (`needs you:` / `done:` / `stuck:`). | Fake claude: working → needs you → done | Tests green |
| G.2 | The live line while it works; the 30-minute cap → stuck. | Garbage / no status line / timeout | Tests green |
| G.3 | Answer it (resume); "Push it" as a separate run that only pushes; **Take the helm** continues the officer's own session. | Fake claude; one real interactive resume | Tests green |
| G.4 | Restart and dismiss: running jobs come back as stuck with "resume"; dismiss removes the worktree. `.claude/worktrees/` goes into the global gitignore. | Cases | Tests green |

**Done check:** "fix CI" on a real failing PR goes through working → needs you or done → Push it, without touching my own checkout.

## What the reshape adds and removes

| Adds | Why | Removes or shrinks |
|---|---|---|
| A sorting rule (`rule` decision) | Sorting must stick, or New fills up every day | Merging stories by hand; "Claude proposes groups" (parked) |
| A start-at-login entry | A helper that isn't running doesn't help | The install step at the very end |
| `POST /items` + one scheduled Claude run | Life sources without a token, an app and a source file each | Maybe the Notion integration, its source and rules (the spike decides) |
| Suggestions when I open a topic | A concrete next step where it matters, at a cost I control by opening | Three separate Claude features (draft, deeper briefing, Tell Claude) → one box |
| Nothing | | The button pair on every item; quiet rows on the bridge |

## How we work

Test first for every pure unit (write the failing test, see it fail, make it pass). One commit per task. A step ends when its done check passes. Every fixture and the demo data are made up, because the repo is public. **A choice about what I see gets tried on my real data before more is built on it**: the first plan's topic size and buttons were agreed on made-up data and didn't survive the real thing.

**Stack:** Node ≥ 22.18 running TypeScript directly (`erasableSyntaxOnly`, no build step); `node --test`; `tsc --noEmit`; `typescript` is the only dev dependency; no runtime dependencies; the pages are plain JS and CSS.

## Files

```
commands/bridge/
  src/
    types.ts  config.ts  clock.ts        the words, settings, working-hours time
    store.ts  poll.ts                    what the sources know; the poll loop, backoff, health
    decisions.ts  topics.ts  urgency.ts  my decisions; items → topics; red / yellow / hot
    briefing.ts  view.ts                 the rule-made briefing; what each page shows
    rules/github.ts  rules/linear.ts     who has the ball per PR / story
    sources/github.ts  sources/linear.ts gh searches + views; Linear GraphQL
    repos.ts  record.ts  demo.ts         repo → clone and the helm link; --record / replay; demo mode
    app.ts  server.ts  main.ts           state; HTTP + SSE; wiring
  to come:
    scripts/install.sh                   A
    rules in decisions/topics            B
    sources/slack.ts  rules/slack.ts  classify.ts      C
    inbox (POST /items)  rules/tasks.ts  rules/calendar.ts   E
    suggest.ts  jobs.ts                  F
    officer.ts                           G
  web/  test/  demo/  docs/  scripts/screenshot.ts
```

## Found in use

*(Step D fills this in.)*

## Done so far

### Before building: tokens and spikes

| # | Task | Done when |
|---|---|---|
| 0.1 | **Slack app. ✅ Done 2026-11-20.** An internal app in the work workspace with a **user** token (xoxp), read-only user scopes: `search:read`, `channels:history`, `groups:history`, `im:history`, `mpim:history`, `channels:read`, `groups:read`, `im:read`, `mpim:read`, `users:read`, `users:read.email`. Create it from the manifest in the README. Keep it internal (not distributed): since May 2025 only internal and Marketplace apps keep Tier 3 limits on `conversations.history`/`replies`; distributed non-Marketplace apps drop to 1 request/min. | `BRIDGE_SLACK_TOKEN` in `~/.claude/bridge/.env`, or the install is waiting on an admin |
| 0.2 | **Linear API key. ✅ Done 2026-11-20:** personal key in `BRIDGE_LINEAR_TOKEN`. | `curl` on `viewer { name }` works |
| 0.3 | **Notion integration: on hold.** Step E's spike decides whether it's needed. Was: internal integration, shared with the GTD databases (ids from the "CLAUDE.md, GTD Systeem Referentie" page). Token in `BRIDGE_NOTION_TOKEN`. | It can query the next-actions database |
| 0.4 | **Spike: officer flags. ✅ Done 2026-11-20** (claude 2.1.329, native install, clean env, haiku). See *Officer spike results* below. | Done |
| 0.5 | **Spike: Slack limits. ✅ Done 2026-11-20** (internal app, user token, all 11 scopes granted). Measured on 14 days of real use (a few hundred messages, a few dozen conversations). Search does all three in one call each (`<@me>`, `from:<@me>`, `is:dm`, ~200–300 ms). So a poll is 3 searches for what's new since the last poll, plus `conversations.replies` only for threads that moved. The first 14-day load is ~6 search pages plus the touched threads, paced under Tier 3 (~50/min); that's fine for an internal app. `search.messages`' own tier wasn't confirmed in the docs: back off on 429 + Retry-After. | Slack every 120 s (the current default) |

### Officer spike results (0.4)

Each run used a clean environment (`env -i` with HOME, USER, TERM and PATH), the way bridge will start it, not the desktop app's environment.

| Check | Result |
|---|---|
| `claude -p --session-id <uuid> --output-format stream-json --verbose "…"` | Works. The `system/init` line carries the session id and cwd; the `result` line carries the text. The status line at the end came back as asked ("needs you: apple or pear?") |
| `claude -p --resume <uuid> "pear…"` | Works. Same session id, and it remembers the question. It ended with "done: pear" as asked |
| `claude -p --worktree <name> --session-id <uuid> --permission-mode acceptEdits "…"` in a git repo | Works. It creates `<repo>/.claude/worktrees/<name>` on branch `worktree-<name>` (marked *locked*) and writes only there; the main checkout is untouched |
| Resume a worktree session **from the repo root** | Works, and runs in the worktree (`pwd` in the resumed run printed the worktree path) |
| Resume from inside the worktree | Works |

What it means for step G:
- **Always pass `< /dev/null`.** Without it, `-p` waits 3 s for stdin and prints a warning.
- **Tools:** `-p` refuses tools that would need approval. The officer gets `--permission-mode acceptEdits` plus an `--allowedTools` list (test commands, git without push). Pushing stays a separate, resumed run after "Push it", with `Bash(git push:*)` allowed only there.
- **Worktrees live inside the repo** (`.claude/worktrees/`), so the repo shows `?? .claude/` unless that path is ignored. Add `.claude/worktrees/` to the global gitignore, or check per repo. Dismissing a job removes the worktree with `git worktree remove --force --force` (it's locked) and deletes the branch.
- **The CLI on PATH is the native install** (`~/.local/bin/claude`, auto-updating). `BRIDGE_CLAUDE_BIN` overrides it for tests.
- **Not tested yet:** interactive `claude --resume <id>` for Take the helm (it needs a terminal; check it in G.3), and a run that hits the 30-minute cap.

### Phase 1: skeleton with demo data

✅ Done 2026-11-20 (commits 79ae4ec…bf1eb2b). Besides the file map it added `app.ts` (running state), `view.ts` (what each page shows, pure) and `demo.ts`; the pages take `?still` to skip live updates, for headless screenshots.

### Phase 2: GitHub + Linear (bridge covers pr-watch's PR view)

✅ Done 2026-11-20, apart from the one-day side-by-side with pr-watch (yours). Checked once on real data: pr-watch's 3 YOUR TURN PRs are all your move in bridge. `test/parity-pr-watch.test.ts` runs pr-watch's own `ballInCourt` on made-up PRs and lists the intended differences: approved with CI running is *in motion*; a PR comment since your last push is yours to answer; your draft with reviewers and failing CI is yours to fix. Learned on real data:
- **Bots:** gh shows app comments (github-actions, shopify) without a bot flag, so `config.bots` names them.
- **Linear mentions:** your Linear notifications bring in stories you're mentioned on, even when they're not yours and no PR points at them. A mention is yellow on open stories and only a log line on done ones (your call; they were status updates).
- **Done topics:** topics where everything is done fold into one line.
- **Keys:** tokens can live in `~/.claude/bridge/.env`.
- **2.6:** the briefing stays the phase-1 version (lines per state, same-day roll-up of routine events); Claude's own view comes in step F.

## Risks

- **Sorting rules guess wrong.** A rule that catches too much hides things in the wrong topic. Bridge always shows the rule it's about to make, and a topic lists the rules that feed it, with remove.
- **One big topic.** The biggest project holds 35 stories. The page groups them by milestone and shows only what needs something; if that's still too much, B.2 pulls a milestone's stories out.
- **The scheduled Claude run (E)** is unproven: reaching bridge on the laptop, cost per run, and what happens after sleep. The spike comes first, and Notion by code is the fallback.
- **Suggestions cost tokens** each time a hot topic changes and I open it. They're kept until the next change, and a config switch turns them to "only when I ask".
- **The topic tab can't bring itself to the front:** accepted (see the parked pr-watch item).
