# Ball in court (BIC)

How pr-watch decides whether a PR is in **YOUR TURN** (top lane) or **WAITING** (bottom lane). Implemented in `lib.mjs` as `ballInCourt(pr, viewerLogin)`; the dashboard uses `ballInCourt(pr, you).has(you)`.

**Installed copy:** `~/.claude/pr-watch/lib.mjs` (keep in sync with this repo via `./scripts/sync-global.sh`).

**Version:** see `poll.mjs` line 2 (currently **0.17.2**).

---

## Mental model

- BIC returns a **set of GitHub logins** who must **act to move the process forward** — not a single owner.
- **Overlap is normal:** e.g. you process reviewer A’s feedback while reviewer B is still requested.
- **WAITING for you** means your login is **not** in that set (someone else may still have the ball).
- **Chips ≠ BIC:** ⏳ CI, 🔴 Conflict, 🟠 Behind are informational. They do not pull you into YOUR TURN unless a review rule already does (e.g. approved → merge).
- We only model **author + requested reviewers + formal reviews** (GitHub `reviewRequests`, `reviews`, `latestReviews`). Drive-by timeline commenters are out of scope.

---

## GitHub review states (important)

Formal review outcomes are **not** the same as “left comments on the PR”:

| User action on review bar | API `state` |
|---------------------------|-------------|
| Approve | `APPROVED` |
| Request changes | `CHANGES_REQUESTED` (there is no `REJECTED`) |
| Comment (submit review) | `COMMENTED` |
| Review started, not submitted | `PENDING` |

Inline or timeline comments **without** submitting a review often produce **no** row in `reviews` / `latestReviews`. Mid-review with only threads → ball stays with a reviewer **still on** `reviewRequests`.

---

## Rules (evaluation order)

### Draft PRs

| Condition | Who has the ball |
|-----------|------------------|
| Draft, no reviewers | Author |
| Draft + `reviewRequests` | Those reviewers |
| Draft + reviewers + someone submitted `COMMENTED` / `CHANGES_REQUESTED` and is off `reviewRequests` | Reviewers **and** author |

### Non-draft PRs

| Condition | Who has the ball |
|-----------|------------------|
| On `reviewRequests` | That login (mid-review or re-requested) |
| Submitted `COMMENTED` / `CHANGES_REQUESTED`, off `reviewRequests` | **Author** (process feedback) |
| Submitted `COMMENTED` / `CHANGES_REQUESTED` / `APPROVED`, off `reviewRequests` | **Not** that reviewer (0.13+) |
| `reviewDecision === APPROVED`, no pending requests | Author (merge; chips show conflict/behind if any) |
| `ciStatus` **FAILURE** | Author (fix checks) |
| `ciStatus` **PENDING** | *Not* author — ⏳ chip only |
| `mergeStateStatus` **DIRTY** / **BEHIND** / etc. | *Not* BIC — chips only; author in court when approved or owes feedback |
| No requests, no `latestReviews`, not approved | Author (assign reviewers) |
| Every `latestReviews` entry is `APPROVED`, no pending requests | Author (merge / chase checks) |
| Set still empty but `reviews` / `latestReviews` has human activity | Author (limp fallback) |

### Reviewer inbox (`role === "reviewer"`)

Only adds **you** when:

- You are on `reviewRequests`, or
- You have no submitted review yet (`!my`), or
- Your latest review is `PENDING`

Does **not** add you after you submitted `COMMENTED` / `CHANGES_REQUESTED` / `APPROVED` and are off `reviewRequests`.

---

## Common scenarios

### Multi-reviewer (A done, B still pending)

- **A** submitted `COMMENTED` or `CHANGES_REQUESTED`, off requests → **author + B**.
- **B** still on `reviewRequests` → **B** only (author WAITING on B unless author also owes feedback from A).

### Wilfred mid-review (comments, no submit)

- Still on `reviewRequests` → **Wilfred’s** court only.

### Wilfred submitted “Comment” review

- Off `reviewRequests`, `COMMENTED` in API → **your** court; **Wilfred WAITING**.

### CI running on your PR

- **Author WAITING** (0.17+); reviewers still in court if requested. Dashboard shows **⏳ CI** in meta chips.

### Conflict or behind while in review

- **Not** author’s court from merge state alone. When approved and in YOUR TURN, **🔴 Conflict** / **🟠 Behind** chips remind you what to fix before merge.

### Approved, ready to merge

- Author in court; reviewers WAITING unless re-requested.

---

## Nobody has the ball?

For PRs with a valid **author** in the poller’s scope (author + formal reviewers):

| Situation | Global void (empty set)? |
|-----------|---------------------------|
| Normal open PR | **No** — author and/or reviewers covered |
| Missing `author.login` | **Yes** (rare) |
| Drive-by commenter only | **Ignored** — not in model; author may still get “assign reviewers” if API shows zero engagement |
| `ciStatus` null while checks run | Usually author or reviewers via other rules; chip may lag |

**Personal WAITING** while someone else has the ball is expected, not a void.

---

## Dashboard chips vs BIC

| Chip | Meaning |
|------|---------|
| **⏳ CI** | Checks in progress (`ciStatus === PENDING`) |
| **❌ CI** | Checks failed |
| CTA chip (🟡 In review, 🟠 Fix requested, …) | Human review state from **your** perspective |
| Merge chip (🔴 Conflict, 🟠 Behind, …) | Branch/merge state |

BIC uses the same underlying fields; chips are display-only and can be read while the card is in either lane.

---

## Testing your global install (`~/.claude/pr-watch`)

From the **ai-kit** repo (source of truth):

```bash
cd commands/pr-watch

# 1. Sync repo → ~/.claude/pr-watch (and optional ~/.claude/commands/pr-watch.md)
./scripts/sync-global.sh

# 2. Unit tests (repo lib.mjs) + smoke scenarios against global lib.mjs
./scripts/sync-global.sh --test

# 3. Smoke only against global (after sync)
node scripts/smoke-global.mjs
```

Override install path:

```bash
PR_WATCH_HOME=/path/to/pr-watch ./scripts/sync-global.sh --test
```

### Live dashboard test

```bash
# Terminal A — poller + SSE dashboard (uses ~/.claude/pr-watch)
node ~/.claude/pr-watch/poll.mjs

# Browser: http://localhost:7654
# YOUR TURN = ballInCourt has your GitHub login
```

Check version:

```bash
head -2 ~/.claude/pr-watch/poll.mjs
```

Restart the poller after syncing `lib.mjs` / `app.mjs` so the dashboard reloads logic (refresh browser; restart poller if it cached old modules).

### Manual BIC probe (one PR)

```bash
node -e "
import { ballInCourt } from '$HOME/.claude/pr-watch/lib.mjs';
const pr = { author: { login: 'YOU' }, reviewRequests: ['bob'], latestReviews: [], ciStatus: 'PENDING', isDraft: false, reviewDecision: 'REVIEW_REQUIRED', role: 'author' };
console.log([...ballInCourt(pr, 'YOU')]); // [] — CI pending does not add author; bob has the ball
"
```

Replace `YOU` / fields with a snapshot from `~/.claude/pr-watch/current.json`.

---

## Maintainer sync checklist

1. Change `lib.mjs` (and tests) in this repo.
2. `node --test test/poll.test.mjs`
3. Bump `poll.mjs` version + `package.json` + `CHANGELOG.md`
4. `./scripts/sync-global.sh --test`
5. Restart running `poll.mjs` / `/pr-watch`

---

## History (CHANGELOG summaries)

| Version | BIC change |
|---------|------------|
| 0.12.1 | Draft + `reviewRequests` → reviewers, not author only |
| 0.12.2 | Author court when one reviewer left `COMMENTED`/`CR` while others pending |
| 0.13.0 | Reviewer off court after submitted `COMMENTED`/`CR`/`APPROVED` when not re-requested |
| 0.14.0 | All-`APPROVED` + limp fallback → author |
| 0.15.0 | CI pending/failure + merge blocked → author (superseded by 0.17.0) |
| 0.16.0 | BEHIND during review no longer → author; DIRTY + CI only; BEHIND when APPROVED |
| 0.17.0 | BIC = act to unblock; CI pending + merge state chips-only |

Full details: [CHANGELOG.md](CHANGELOG.md).
