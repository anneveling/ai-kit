# Bridge: design

*2026-11-20 · Status: phases 1–2 built (GitHub, Linear, both pages); reshaped the same day after running on real data, see the [plan](../plans/2026-11-20-bridge-plan.md) · Idea page: Notion "💡 AI ideas" → Bridge*

## Why

Today the things I need to do, answer or keep an eye on are spread over Slack, GitHub (PRs and CI), Linear and my GTD system in Notion. pr-watch covers PRs only. So I still go round every source to check whether I missed something, and I switch context to do it.

Bridge is one local app that does that round for me, at work and outside it: my life helper. It polls every source by code (no tokens), groups everything into **topics**, works out for each topic **who has the ball** and **what's next**, and shows it on one page: the bridge. Each topic has its own browser tab with the detail. Claude helps on demand: drafting, briefing, and doing work in the background (**Make it so**).

Over time bridge takes over pr-watch. pr-watch keeps running until bridge covers what it does.

**Success check after a week of real use:** do I still check Slack and GitHub myself to see if I missed something? How often is the suggested next action wrong?

## Scope

### v1

- **Runs** on the laptop: one local server, rebuilt from the sources on start.
- **Sources:** Slack (DMs, @mentions, threads I posted in), GitHub (my PRs, PRs where my review is asked, reviews, CI), Linear (stories: status, project, milestone, comments), my GTD tasks in Notion (next actions, waiting-fors), my calendar (today), and Claude's own jobs. The fast ones (GitHub, Linear, Slack) are polled by code. The slow life sources (GTD, calendar) come through a scheduled Claude run that posts to bridge a few times a day, if the spike in the plan holds.
- **Topics:** one per Linear project by default (decided 2026-11-20: per story gave 53 topics in 14 days, 35 of them one project). A story without a project gets its own topic. I pull a story or a few out into their own topic when I want that, and move single items myself. When I sort something, bridge asks once whether that always holds (a sorting rule), so New doesn't fill up again.
- **The bridge page** and a **topic page** per topic (see UX).
- **Take the helm:** one button per topic. I open Claude myself, with the topic as context.
- **Claude suggests:** when I open a topic that's my move, Claude suggests one to three next steps (kept until the topic changes). **Make it so** sits only next to a suggested step Claude can do: it does it in the background and comes back when it needs me or is done. First steps without code (a draft, a GTD task), later code.
- **Ask Claude:** one box on each topic. My question gets an answer and, where it fits, suggested steps.
- **Promises:** when I promise something in Slack ("I'll fix it tomorrow"), bridge proposes a GTD task linked to the topic. It's added only after I OK it.
- **Sending:** none. Bridge drafts and opens the thread; I send. The officer never pushes, sends or merges without asking. Later, sending as me goes through Claude's own Slack connector after my OK per message; bridge's own Slack token stays read-only (decided 2026-11-20).

### Not now

- Claude Code sessions as a source (parked; the other sources already see the results of session work).
- Email. Calendar beyond today.
- Sending from bridge.
- Always-on hosting (Hetzner), phone push.
- History older than 14 days.
- More than one user.
- Retiring pr-watch (only once bridge covers it).

## Words

| Word | Meaning |
|---|---|
| **Item** | One thing with its own id in a source: a PR, a story, a Slack thread, a GTD task, an officer job. Id = source-native ref, e.g. `github:org/repo#412`, `linear:BG-1234`, `slack:C0123/1700000000.000100`, `notion:<page-id>`, `job:<uuid>` |
| **Event** | Something that happened on an item, with who and when: a message, comment, review, status change, CI run, job update |
| **Person** | One human across sources (Slack, GitHub and Linear handles), from `config.json` and matched by email where the APIs give one |
| **Topic** | A group of items: a thread I think in. Default: one per Linear project. Can hold many items per source. Has a colour and an area |
| **Sorting rule** | "Things like this always go to that topic": a match on title prefix, repo, Slack channel or person. Made when I sort an item and say it always holds |
| **Area** | Where a topic lives, e.g. Work, Side project, Personal. Mapped from repo, Slack channel, Linear team or GTD area in `config.json`; can be set per topic |
| **New** | Items that belong to no topic yet (the GTD clarify step) |
| **Ball** | The set of people or things that must act next on an item: me, named people, CI, the officer, or nobody. Several at once is normal |
| **Next action** | What I could do next: reply, review, fix, address, merge, nudge, do, answer, approve. Carries a reason, an urgency and optionally a draft |
| **Officer** | Claude running a job in the background for a topic |

## The ball and the next action

Each item gives: **ball** (a set), **since** (when the ball last moved), **next action**, **urgency**. My own actions in any source count, wherever I did them (in Slack by hand, through a Claude connector, from the CLI): if I answer Sam in Slack, the ball leaves me.

### Rules per source

**GitHub**

| Situation | Ball | Next |
|---|---|---|
| My PR, CI failing | me | fix |
| My PR, changes requested, or comments since my last push | me | address |
| My PR, approved + CI green + mergeable | me | merge |
| My PR, waiting on requested reviewers | them | nudge after 48h |
| CI running | in motion | none |
| Someone's PR, my review requested and not given since the request | me | review |
| My draft with no reviewers | quiet | none |

GitHub does not show a review in progress, so the wording is "with Toby for review", never "Toby is reviewing".

**Linear:** a comment that mentions me, or replies to mine, puts the ball with me (reply). It's yellow, never red, until the model check (phase 3) confirms it's a question; on a done or cancelled story it's only a log line (decided 2026-11-20: on real data such comments were status updates). Stories come from my assignments, my Linear notifications (mentions, comments) and the keys PRs mention. Status and assignee changes are log events only. A story assigned to me is work, not attention, so on its own it doesn't make it my move.

**Slack**

| Situation | Ball | Next |
|---|---|---|
| DM where the last message isn't mine | me | reply |
| @mention with no reply from me after it | me | reply |
| My question with no answer | them | nudge after 24h |
| Other new messages in my threads | the Slack check decides | reply, or just activity |
| A message of mine that promises something | none | propose a GTD task |

**The Slack check:** a cheap model answers "is this asking me something?" (for others' messages) or "did I promise something, by when?" (for mine). It runs once per message the rules can't place, and the answer is cached. If it fails, the message counts as "maybe for me" and stays visible. In a thread that already belongs to a topic, an unclear message stays in that topic as "maybe for you". An unlinked one goes to New, where I can move it to a topic.

**Notion GTD:** a next action due today or overdue means me, *do*. A waiting-for task means them, nudge on its date. Other tasks are listed but quiet.

**Officer:** *working* counts as in motion. *Needs you* means me, *answer*. *Done, ready to push* means me, *approve*. *Stuck* means me, with its log.

### Per topic

A topic takes the most urgent state of its items: **your move** > **in motion** > **waiting** > **quiet**.

### Alert levels

- **Red alert:** my move **and** someone or something is stuck on me. That means one of:
  - a question to me older than 2h within working hours
  - CI red on an approved PR
  - a GTD task overdue
  - an officer question on a topic that's already red
- **Yellow:** any other "my move".
- **Hot on the bridge:** at most three topics, red first, then the longest waiting. A nudge stays in Waiting and is never hot.
- **Working hours:** 09:00–18:00 on weekdays, set in `config.json`. Outside them the 2h clock doesn't run.

## UX

Dark by default. Calm: type and thin lines carry the layout, colour is a small square per topic, no tinted cards. Two buttons, each in one place only (decided 2026-11-20; a pair on every item was noise):

- **Take the helm** (outline): once per topic, in its header. Opens a Claude session with the topic's context, in the clone of the thing that most needs me, continuing Claude's own session if it worked on the topic.
- **Make it so** (amber, filled), with a sub-line like "Claude drafts the reply": only next to a step Claude suggested and can do. Everything else under *Needs you* is a plain link to the thing.

### The bridge page (overview only)

The bridge shows what needs attention and where to go. It has no actions: every topic links to its tab.

- **Hot topics** at the top: up to three, as text columns separated by thin lines. Each shows the area label, the topic's colour square and name, one line of what's happening, who has the ball (with the alert level) and since when, and *Open*. When the hot topics span more than one area (e.g. work and personal), the hot block splits by area so you see where the pressure is. When they're all in one area, there's no split.
- **New · not sorted** below that: one line per item with its best-guess topic and *Sort*.
- **Today:** one line with today's calendar events and the tasks due today.
- **The table:** every other topic that needs me, is moving or waits on someone, one line each. It has the colour square, name, a dot plus one line of what's happening (● your move · pulsing ● in motion · ● waiting), since when, and *Open*. Grouped by area. Quiet topics and done ones fold into a count each ("7 quiet · 43 done") that opens on a click.
- **Officer work** shows as status only ("Officer needs you: backoff or test wait?").
- **Quiet state:** "All quiet on the bridge", with a count of what's in motion or waiting, and the table.
- **Source health** in the header: a source that's offline or has an expired token says so.

### The topic page (one tab per topic)

Opening a topic uses a named browser tab per topic id, so a second click or a link opens the same tab, not a new one. (Related parked item: a page can't reliably bring its own tab to the front. Accept that for v1.)

- **Header:** area, colour square, name, who has the ball and since when, and **Take the helm**. Controls: snooze, close (with a reopen rule: when the ball comes to me / on any activity / never), edit (name, colour, area).
- **Left column:**
  - **Briefing:** a few plain sentences on where things stand, built by rules (free).
  - **Needs you:** one line per thing that waits on me, with a link to it and dismiss. Rule-made, free, always there.
  - **Claude suggests:** one to three next steps with why, made when I open a topic that's my move and kept until it changes. **Make it so** next to the ones Claude can do; Claude's states show in place: working (live line), needs you (its question plus an answer box), done (what's ready), stuck.
  - **Ask Claude:** the box.
  - **Log, newest first:** events from every source. Events new since my last visit get a blue line; my own events are dimmed. Routine events roll up ("3 PRs merged (#801, #805, #809) · BG-1630, BG-1631 → Done"). Older events fold under *show older*.
- **Right column:**
  - **Where things stand:** per source, a count line with a small segmented bar, then only the items that need something, and "all N" for the full list. Linear shows the stories grouped by milestone, with progress toward go-live; GitHub shows each PR's review, CI and merge state; Slack shows each thread's last message and whether a question is open to me; GTD shows linked tasks. Several items per source are normal.
  - Items can be moved to another topic ("belongs to…", a select of the open topics) or split off into their own; a story takes its PRs and threads along. Moving offers "always" (a sorting rule). The topic lists the rules that feed it, with remove.

## The officer (Make it so)

The officer is Claude doing a suggested step in the background. Steps without code (a draft, a GTD task) come first and need no worktree: one `claude -p` run with the topic's context pack, and the result shows in place. What follows describes jobs that change code, which come last.

- Each job gets a new git worktree of the repo (the repo comes from the item; local clone paths work like pr-watch's `repos.mjs`), a fixed session id, and a prompt with the next action plus the topic's context pack (briefing, items, recent log).
- It runs as `claude -p --session-id <id>` in that worktree, with `--output-format stream-json`, so bridge can show a live line.
- The prompt tells it to end every run with one status line: `needs you: <question>`, `done: <what's ready>` or `stuck: <why>`. Bridge reads that line rather than guessing from the text.
- **Answering** resumes the same session: `claude -p --resume <id> "<answer>"`. **Take the helm** opens it interactively: `claude --resume <id>`, in the worktree.
- It never pushes, sends, merges or closes by itself. A push is a *done* state with "Push it".
- Cap: 30 minutes per run. Past that it's *stuck*. The worktree stays until I dismiss the job.
- The jobs are kept in `jobs.jsonl` (topic, action, session id, worktree, status, open question), so a restart picks them up again.
- *To verify while building:* that `--session-id`, `--resume` and `--worktree` combine as described with `-p`. The flags exist (checked in `claude --help`); the combination is untested.

## Architecture

One local Node process, TypeScript run directly by Node 22.18+ (22.23 is installed here and runs `.ts` unflagged; 24 works too) (type stripping, no build step; `tsc --noEmit` for type checks; erasable syntax only: no `enum`, `namespace` or parameter properties). Same shape as pr-watch: HTTP plus SSE push. It has no runtime dependencies; `typescript` is the only dev dependency. It lives in `commands/bridge/` in ai-kit and is installed to `~/.claude/bridge/`, as pr-watch is.

```
 IN (poll 1–2 min)        THINK (rebuilt in memory)            OUT
 sources/github.ts ─┐
 sources/slack.ts  ─┤     store.ts  (items, events, people)    server.ts (HTTP + SSE)
 sources/linear.ts ─┼──►     │                                   ├─ web/bridge.*
 sources/notion.ts ─┤     rules/*.ts   → ball, next, urgency     └─ web/topic.*
 officer.ts (jobs) ─┘        │
                          topics.ts    → membership + roll-up
                             │         (applies decisions.jsonl)
                          briefing.ts  → briefing + one-liners
                          classify.ts  → Slack check (cheap model, cached)
                          drafts.ts    → on-demand drafts, deeper briefing, group proposals
```

| Unit | Does | Pure? |
|---|---|---|
| `sources/*.ts` | `poll(since) → { items, events }` per source. GitHub via `gh api graphql`; Slack, Linear and Notion via `fetch` with tokens from env | no |
| `store.ts` | Holds items, events and people for the last 14 days; merges each poll in | no |
| `rules/*.ts` | `(item, events, me, now, config) → { ball, since, next, urgency }` | yes |
| `topics.ts` | `(items, decisions) → topics`: story key → topic, applies merges, moves, closes, snoozes, seen; rolls up topic state | yes |
| `briefing.ts` | `(topic) → sentences`; the bridge one-liner | yes |
| `classify.ts` | Slack check through a cheap model, once per message, cached on disk | no |
| `drafts.ts` | On demand: draft reply, deeper briefing, propose groups for New | no |
| `officer.ts` | Starts, resumes and watches jobs; parses status lines; writes `jobs.jsonl` | no |
| `server.ts` | Routes: `/` bridge, `/t/<topic>` topic page, `/events` SSE, `POST /decide`, `POST /officer`, `POST /seen` | no |

### What this adds to the architecture

| Adds | Why | Instead of |
|---|---|---|
| Slack app with a user token (read scopes) | Slack is the first win | The Slack MCP connector costs tokens per read, so it can't poll |
| Linear and Notion API tokens | Status, milestone, comments, GTD by code | MCP connectors: same reason |
| Officer runner + `jobs.jsonl` | Make it so in v1 | pr-watch's chips do Take the helm only |
| Cheap classifier + cache | Slack messages the rules can't place; promises | none |
| A second local server | Bridge itself | pr-watch's server; pr-watch goes once bridge covers it |
| TypeScript on Node 22.18+ | Types for a bigger codebase | Plain `.mjs` on Node 18+, like pr-watch |
| A sorting rule (a kind of decision) | Sorting must stick, or New fills up every day | Merging stories by hand |
| A start-at-login entry (LaunchAgent) | A helper that isn't running doesn't help | Starting it by hand |
| `POST /items` and a scheduled Claude run | Life sources (GTD, calendar) without a token, an app and a source file each; pending the spike | A Notion integration and source by code |

## State

- **In memory, rebuilt:** everything the sources know. 14 days on start, then only what changed on each poll.
- **`decisions.jsonl`** (append-only, the only state that is mine): `merge`, `move`, `new_topic`, `split`, `rule` (a sorting rule) and its removal, `close` (+ reopen rule), `snooze` (until), `dismiss_action`, `seen` (topic, up to), `area`, `name`, `colour`, `accept_task` / `reject_task` (promises). Replayed on start.
- **Topic ids:** `project:<slug>` for automatic topics, `story:BG-1636` for a story without a project or one I pulled out; a short slug for topics I made. Where an item lands, first match wins: my move of that one item, a story I placed, a sorting rule, the project, the story, New.
- **`jobs.jsonl`:** officer jobs.
- **`classify-cache.jsonl`:** can be deleted.
- **`config.json`:** me (handles per source), people, areas (repo / channel / team / GTD area → area), colours, working hours. Tokens come from env, never from this file.
- **Notion** stays the store for GTD: bridge reads it, and writes tasks only after I OK them.

## Errors

The rule is never a silent gap, because a silent gap is what sends me back to checking each source myself.

- **Source down or token expired:** the bridge header says so with the time. That source's items stay, marked stale. The other sources keep working.
- **Rate limits:** each source backs off on its own. Slack's limits on searching mentions are the tightest. Check the actual tier limits while building, before setting the poll interval.
- **Slack check fails:** the message counts as "maybe for you".
- **Officer crash or 30-minute cap:** the job goes *stuck*, the ball goes to me with the log, and the worktree is kept.
- **Corrupt line in `decisions.jsonl`:** skip it, report it in the header, and never rewrite the file.

## Testing

- **Pure units** (rules, topics, briefing): `node --test` with fixture files. Every rule in the tables above gets a case.
- **Sources:** contract tests on recorded responses. The repo is public, so the fixtures in it are made up. `--record` writes real responses to a local folder outside git, so I can test against my own data.
- **Officer:** a fake `claude` binary (`BRIDGE_CLAUDE_BIN`) that prints stream-json and a status line.
- **UI:** a demo mode with made-up data, like pr-watch's `docs/demo.json`, plus a screenshot script.
- **Real use:** the success check after a week.

## Build order

The order lives in the [plan](../plans/2026-11-20-bridge-plan.md), as steps that each end in something I can use: **A** mine to run (starts at login) · **B** topics per project, sorting rules, calmer pages, the new buttons · **C** Slack · **D** a week of use · **E** GTD and calendar · **F** Claude on a topic (suggestions, Ask Claude, Make it so without code) · **G** Make it so for code. Phases 1–2 of the first plan (skeleton, GitHub and Linear) are built.

## Open, to settle while building

- Slack tier limits → the poll interval per source.
- Whether a named tab can be brought to the front from the bridge page in my browser.
- The exact cheap model and the prompt for the Slack check.
- ~~Whether `-p` combines with `--session-id`, `--resume` and `--worktree`~~: checked 2026-11-20, it does (see the plan, spike 0.4).
