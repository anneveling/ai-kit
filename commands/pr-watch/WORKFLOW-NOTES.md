# Team workflow — limits, tools, and directions

High-level notes from designing pr-watch ball-in-court (BIC) for a small AI-augmented team. Complements [BALL-IN-COURT.md](BALL-IN-COURT.md) (implementation rules) with **why** the model is shaped this way and what we might do instead.

**Audience:** future us — when we wonder why something feels wrong on the dashboard or whether to bolt on more heuristics.

---

## What pr-watch is trying to answer

**“What do I need to do *now* to move this PR forward?”**

Not:

- “Who is responsible for this PR?”
- “Is CI running?”
- “Is there a merge conflict?”

Those are related but different. Passive infrastructure state (CI pending, behind main mid-review) belongs on **chips**, not in YOUR TURN. See **0.17.0** in [CHANGELOG.md](CHANGELOG.md).

---

## GitHub PR model — built-in limits

GitHub PRs are **merge contracts**, not **collaboration workspaces**.

| Concept | What GitHub gives you |
|--------|------------------------|
| Owner | **One author** (who opened the PR) |
| Collaborators | Push access only — no “contributor” role in review state |
| Who acts next | Inferred from `reviewRequests`, formal `reviews`, `reviewDecision` |
| Commits on someone else’s branch | Just more commits; author unchanged |
| Review + push by same person | Two activities, one data model — intent not encoded |
| Staleness | Search `updatedAt` often doesn’t move when CI finishes or reviewers are added (poller mitigates with light refresh — see 0.16.x) |

**Implication:** pr-watch (and any GitHub-native inbox) is a **compensating layer** on top of a model that assumes *one author, async formal reviewers, merge when approved*.

Heuristics like “last pusher gets the ball” break quickly: multiple drive-by commits, mixed reviewer + contributor hats, re-request vs stale review API quirks.

---

## What we scoped into BIC (0.17.0)

**In court** = author + requested reviewers + formal review outcomes, plus:

- Author owes feedback (submitted `COMMENTED` / `CHANGES_REQUESTED`, off requests)
- Approved, no pending requests → author (merge path)
- CI **failure** → author (fix checks)
- No engagement → author (add reviewers)
- Gap fallbacks (all approved, limp)

**Not in court** (chips only):

- CI **pending** (⏳)
- Merge state: **DIRTY**, **BEHIND**, etc. (🔴 / 🟠) — visible when already in YOUR TURN for review/merge reasons

**Out of scope entirely:** drive-by timeline commenters, Slack, Linear assignee, pairing without config.

---

## Where our process rubs against the model

Typical friction for this team:

1. **Draft + reviewers added** — dashboard showed author court because cached `reviewRequests` was empty (fixed in poller 0.16.3).
2. **Drive-by fixes on a teammate’s branch** — skip comment → CR → fix loop; GitHub still shows single author; BIC unchanged by your pushes.
3. **Review + push on same PR** — tool cannot know whether you’re “done helping” or “waiting for ack.”
4. **Re-request after CR** — live GitHub may show reviewer on requests while `latestReviews` is empty; BIC follows requests.

These are **process + data model** gaps, not just BIC bugs.

---

## Other tools and how they think

Nothing mainstream fully solves multi-person co-editing on one branch with explicit ball tracking. Common patterns:

### Change-based review (Gerrit, legacy Phabricator)

- Unit of work = **change + patch sets**, not “branch with N commits.”
- “Waiting on” and revision history are first-class.
- **Trade-off:** different git culture; Phabricator gone; heavy for GitHub-centric teams.

### Stacked / small PRs (Graphite, GitHub `gh-stack`, Sapling)

- Split work into **dependent small PRs** instead of one long-lived branch.
- **Helps:** one author per PR; clearer review units; less drive-by ambiguity.
- Graphite explicitly targets “Phabricator-like queue on GitHub” — still one author per PR.

### Work tracker as source of truth (Linear, Jira, GitHub Projects)

- Custom fields or columns for **assignee / ball in court** (teams do this when code hosting isn’t enough).
- **Helps:** arbitrary handoffs, agents, pairing.
- **Trade-off:** manual or bot sync; PR and ticket can drift.

### Automation (Mergify, Aviator, CODEOWNERS)

- Merge queues, auto-assign, auto-merge when green.
- **Helps:** landing approved work.
- **Doesn’t help:** mid-review collaboration or ownership.

### AI review bots (CodeRabbit, Greptile, …)

- Comments and summaries.
- **Helps:** first pass.
- **Risk:** more noise unless tiered with human process.

---

## Process directions (beyond more BIC rules)

| Situation | Direction |
|-----------|-----------|
| Obvious fix on teammate’s PR | **Micro-PR onto their branch** or push + short `drive-by:` note — don’t rely on BIC to reflect it |
| Mixing “I fixed it” and formal review on same PR | Pick a hat: **contributor** (push, no CR) or **reviewer** (comment, they fix) |
| Big / shared feature | **Stack** (Graphite / `gh-stack`) or **Linear driver** on a linked issue |
| Agent changes | Prefix commit (`[ai-fix]`), summary comment, **author ack** before merge |
| Fix tiers | Typo/obvious → push; behavior/API → CR; unsure → ask |

**Fix tiers (team norm):**

- **Tier 1** — typo, import, test name → push or micro-PR + one-line handoff  
- **Tier 2** — behavior, API, security → comment or request changes  
- **Tier 3** — uncertain → don’t push; discuss  

---

## pr-watch roadmap ideas (prioritized)

**Done**

- BIC = act to unblock (0.17.0): CI failure only; merge state chips-only  
- Poller light refresh on cache hit (0.16.3+)  

**High value, small scope**

- **Ball age** — surface `bicSince` (“in your court 2d”) on ACT cards  
- **Commits since last review** — stale review nudge (author or re-request reviewers)  
- **Optional pairing list** — show teammates’ PRs you’re watching (commented/pushed); separate lane, no fake BIC  

**Explicitly deferred / fragile**

- Last-pusher heuristics (breaks on multiple commits + review)  
- Modeling every drive-by commenter  
- Team-wide shared dashboard as v1 product  

**Later**

- Third lane: ACT / WAIT / **WATCH** (passive CI, etc.)  
- Link or sync with Linear if ticket becomes source of ball  

---

## Design principles (keep)

1. **Multi-ball is OK** — author and reviewers can overlap (process A’s feedback while B reviews).  
2. **Personal inbox first** — author + formal reviewer + optional pairing; not all git activity.  
3. **Chips ≠ court** — conflict/CI/behind inform; they don’t pull you into YOUR TURN alone.  
4. **Don’t expand BIC to model everything** — when GitHub isn’t enough, change **process** (micro-PR, stack, ticket) or add an **explicit** pairing scope, not more inference.  

---

## One-line summary

**GitHub tells you merge state and formal reviews; it doesn’t tell you collaboration intent. pr-watch optimizes a personal “what do I do next?” queue inside that constraint — not a full team workflow engine.**

---

*Last updated: 2026-06-04 (through pr-watch 0.17.0).*
