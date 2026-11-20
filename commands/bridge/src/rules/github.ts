// GitHub: one PR → who has the ball, since when, what's next. Pure.
//
// The spec's GitHub table, plus what pr-watch learned (BALL-IN-COURT.md):
// an empty reviewDecision can still mean approved; the author's own reviews
// don't count; an empty-body COMMENTED review is a reviewer mid-review
// ("Add single comment"), so the ball stays with them.
// GitHub can't show a review in progress: say "with Toby for review", never "Toby is reviewing".

import { HOUR } from "../clock.ts";
import type { Assessment, Ball, BallHolder, Event, ItemTone, NextAction } from "../types.ts";

export interface GhReview { author?: { login: string; is_bot?: boolean }; state: string; submittedAt: string; body?: string }
export interface GhCheck { name?: string; workflowName?: string; context?: string; status?: string; conclusion?: string; state?: string; startedAt?: string; completedAt?: string }
export interface GhComment { author?: { login: string; is_bot?: boolean }; createdAt: string; body?: string }

/** A PR as `gh pr view --json` gives it, with reviewRequests flattened to logins and the repo added. */
export interface GhPr {
  number: number;
  title: string;
  url: string;
  repo: string;
  author: { login: string; name?: string; is_bot?: boolean };
  isDraft: boolean;
  state: "OPEN" | "MERGED" | "CLOSED" | string;
  reviewDecision: string;
  reviewRequests: string[];
  reviews: GhReview[];
  statusCheckRollup: GhCheck[];
  createdAt: string;
  updatedAt: string;
  mergeable: string;
  mergeStateStatus: string;
  headRefName: string;
  commits: { committedDate: string }[];
  comments: GhComment[];
  mergedAt?: string | null;
  closedAt?: string | null;
  mergedBy?: { login: string } | null;
}

/** Maps a GitHub login to a person id ("me" for you) and a display name; knows the bots. */
export interface People { id(login: string): BallHolder; name(login: string): string; bot?(login: string): boolean }

export interface PrResult {
  assessment: Assessment;
  status: { label: string; tone: ItemTone };
}

const NUDGE_AFTER = 48 * HOUR;

type Ci = "FAILURE" | "PENDING" | "SUCCESS" | null;

const FAILED = new Set(["FAILURE", "ERROR", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE"]);

/** The latest run per check decides; any failure fails, then any pending is pending. */
export function ciState(checks: GhCheck[]): { state: Ci; failedAt?: string; failedName?: string } {
  if (checks.length === 0) return { state: null };
  const latest = new Map<string, GhCheck>();
  for (const c of checks) {
    const key = `${c.workflowName ?? ""}\0${c.name ?? c.context ?? ""}`;
    const prev = latest.get(key);
    if (!prev || (c.startedAt ?? "") >= (prev.startedAt ?? "")) latest.set(key, c);
  }
  const runs = [...latest.values()];
  const failed = runs.filter((c) => FAILED.has(c.conclusion ?? "") || FAILED.has(c.state ?? ""));
  if (failed.length) {
    const last = failed.sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? ""))[0]!;
    return { state: "FAILURE", failedAt: last.completedAt, failedName: last.name ?? last.context };
  }
  const pending = runs.some((c) => (c.status && c.status !== "COMPLETED") || c.state === "PENDING" || c.state === "EXPECTED");
  return { state: pending ? "PENDING" : "SUCCESS" };
}

const STORY_KEY = /\b([A-Za-z]{2,6})-(\d{1,6})\b/g;

/** "BG-1636" from the title, else the branch. With prefixes, only those teams count. */
export function storyKeyOf(pr: { title: string; headRefName?: string }, prefixes?: string[]): string | undefined {
  for (const text of [pr.title, pr.headRefName ?? ""]) {
    for (const m of text.matchAll(STORY_KEY)) {
      const prefix = m[1]!.toUpperCase();
      if (!prefixes || prefixes.length === 0 || prefixes.includes(prefix)) return `${prefix}-${m[2]}`;
    }
  }
  return undefined;
}

const inProgress = (r: GhReview) => r.state === "PENDING" || (r.state === "COMMENTED" && !(r.body ?? "").trim());
const latestOf = (dates: (string | undefined | null)[]) => dates.filter((d): d is string => Boolean(d)).sort().at(-1);
let isBot: (login: string) => boolean = () => false;
const human = (a?: { login: string; is_bot?: boolean }) =>
  Boolean(a?.login) && !a?.is_bot && !a!.login.endsWith("[bot]") && !isBot(a!.login);

function latestReviews(pr: GhPr): Map<string, GhReview> {
  const by = new Map<string, GhReview>();
  for (const r of pr.reviews) {
    if (!human(r.author) || r.state === "DISMISSED") continue;
    const prev = by.get(r.author!.login);
    if (!prev || r.submittedAt > prev.submittedAt) by.set(r.author!.login, r);
  }
  return by;
}

const sortedBall = (holders: BallHolder[]): Ball => [...new Set(holders)].sort();
const list = (names: string[]) => (names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);

export function assessPr(pr: GhPr, me: string, now: Date, people: People): PrResult {
  isBot = people.bot ?? (() => false);
  const n = `#${pr.number}`;
  const result = (a: Assessment, label: string, tone: ItemTone): PrResult => ({ assessment: a, status: { label, tone } });

  if (pr.state === "MERGED") {
    return result({ ball: [], state: "quiet", since: pr.mergedAt ?? pr.updatedAt, line: `${n} merged` }, "merged", "done");
  }
  if (pr.state === "CLOSED") {
    return result({ ball: [], state: "quiet", since: pr.closedAt ?? pr.updatedAt, line: `${n} closed` }, "closed", "done");
  }

  const author = pr.author.login;
  const reviews = latestReviews(pr);
  reviews.delete(author); // the author's own reviews don't count
  const requested = pr.reviewRequests.filter((r) => r !== author);
  const lastPush = latestOf(pr.commits.map((c) => c.committedDate)) ?? pr.createdAt;
  const ci = ciState(pr.statusCheckRollup);
  const id = (login: string) => people.id(login);
  const name = (login: string) => people.name(login);

  if (author !== me) return assessReview(pr, me, n, reviews, requested, lastPush, people);

  // ── My PR ──
  const reviewers = [...requested, ...[...reviews.values()].filter(inProgress).map((r) => r.author!.login)];
  const decision = pr.reviewDecision
    || ([...reviews.values()].some((r) => r.state === "CHANGES_REQUESTED") ? "CHANGES_REQUESTED"
      : [...reviews.values()].some((r) => r.state === "APPROVED") ? "APPROVED" : "");
  const approvers = [...reviews.values()].filter((r) => r.state === "APPROVED").map((r) => r.author!.login);
  const approved = decision === "APPROVED" && requested.length === 0;

  const changesAsked = [...reviews.values()].filter((r) => r.state === "CHANGES_REQUESTED" && !requested.includes(r.author!.login));
  // Feedback since my last push: submitted comment reviews and PR comments by others.
  const feedback = [
    ...[...reviews.values()].filter((r) => r.state === "COMMENTED" && !inProgress(r) && !requested.includes(r.author!.login) && r.submittedAt > lastPush)
      .map((r) => ({ login: r.author!.login, at: r.submittedAt })),
    ...pr.comments.filter((c) => human(c.author) && c.author!.login !== me && c.createdAt > lastPush)
      .map((c) => ({ login: c.author!.login, at: c.createdAt })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  const mine = (since: string, line: string, next: NextAction, extra: Partial<Assessment> = {}): Assessment =>
    ({ ball: sortedBall(["me", ...reviewers.map(id)]), state: "your_move", since, line, next, ...extra });

  if (changesAsked.length) {
    const first = changesAsked.sort((a, b) => a.submittedAt.localeCompare(b.submittedAt))[0]!;
    const who = list(changesAsked.map((r) => name(r.author!.login)));
    return result(mine(first.submittedAt, `${who} asked for changes on ${n}`,
      { verb: "address", label: `Address ${who}'s review on ${n}`, officer: "Claude makes the changes", helm: "you make them" }),
    "changes requested", "attention");
  }
  if (ci.state === "FAILURE") {
    const after = approvers.length ? ` after ${list(approvers.map(name))} approved it` : "";
    return result(mine(ci.failedAt ?? pr.updatedAt, `CI failed on ${n}${after}`,
      { verb: "fix", label: `Fix CI on ${n}`, reason: ci.failedName ? `${ci.failedName} failed` : undefined, officer: "Claude fixes it", helm: "you fix it" },
      approved || decision === "APPROVED" ? { stuck: "ci_red_approved" } : {}),
    "CI ✗", "attention");
  }
  if (feedback.length) {
    const who = list([...new Set(feedback.map((f) => name(f.login)))]);
    return result(mine(feedback[0]!.at, `${who} commented on ${n}`,
      { verb: "address", label: `Answer ${who} on ${n}`, officer: "Claude drafts the answers", helm: "you answer" }),
    "comments", "attention");
  }
  if (approved) {
    const since = latestOf([...reviews.values()].filter((r) => r.state === "APPROVED").map((r) => r.submittedAt)) ?? pr.updatedAt;
    if (ci.state === "PENDING") {
      return result({ ball: ["ci"], state: "in_motion", since: lastPush, line: `CI running on ${n}, already approved` }, "CI running", "active");
    }
    if (pr.mergeable === "CONFLICTING" || pr.mergeStateStatus === "DIRTY") {
      return result(mine(since, `${n} is approved but has conflicts`,
        { verb: "merge", label: `Resolve conflicts and merge ${n}`, officer: "Claude resolves them", helm: "you resolve them" }),
      "conflicts", "attention");
    }
    return result(mine(since, `${n} is approved and ready to merge`, { verb: "merge", label: `Merge ${n}`, helm: "you merge it" }),
      "ready to merge", "attention");
  }
  if (pr.isDraft && reviewers.length === 0 && reviews.size === 0) {
    return result({ ball: [], state: "quiet", since: lastPush, line: `${n} is a draft` }, "draft", "idle");
  }
  if (reviewers.length) {
    const ball = sortedBall(reviewers.map(id));
    const names = list(reviewers.map(name));
    if (ci.state === "PENDING") {
      return result({ ball: sortedBall(["ci", ...ball]), state: "in_motion", since: lastPush, line: `CI running on ${n}; with ${names} for review` }, "CI running", "active");
    }
    const since = latestOf([lastPush, pr.createdAt])!;
    const old = now.getTime() - Date.parse(since) >= NUDGE_AFTER;
    return result({
      ball, state: "waiting", since, line: `${n} is with ${names} for review`,
      ...(old ? { next: { verb: "nudge", label: `Nudge ${names} about ${n}`, officer: "Claude drafts the nudge", helm: "you nudge" } as NextAction } : {}),
    }, `with ${names}`, "active");
  }
  if (reviews.size === 0) {
    return result(mine(latestOf([lastPush, pr.createdAt])!, `${n} has no reviewers yet`,
      { verb: "do", label: `Ask for a review on ${n}`, helm: "you pick reviewers" }), "no reviewers", "attention");
  }
  // Reviews are in, nothing open, not approved: someone has to look again.
  const last = [...reviews.values()].map((r) => r.author!.login);
  return result(mine(lastPush, `${n} needs another look from ${list(last.map(name))}`,
    { verb: "do", label: `Ask ${list(last.map(name))} to review ${n} again`, helm: "you ask" }), "re-review", "attention");
}

function assessReview(
  pr: GhPr, me: string, n: string, reviews: Map<string, GhReview>, requested: string[], lastPush: string, people: People,
): PrResult {
  const author = pr.author.login;
  const authorName = people.name(author);
  const my = reviews.get(me);
  const since = latestOf([lastPush, pr.createdAt])!;
  const review = (label: string, at: string, line: string): PrResult => ({
    assessment: {
      ball: sortedBall(["me", ...requested.filter((r) => r !== me).map(people.id)]), state: "your_move", since: at, line,
      next: { verb: "review", label, officer: "Claude reviews it first", helm: "you review it" },
    },
    status: { label: "your review", tone: "attention" },
  });

  if (requested.includes(me)) {
    return my
      ? review(`Re-review ${n} for ${authorName}`, latestOf([since, my.submittedAt])!, `${authorName} asked you to look at ${n} again`)
      : review(`Review ${n} for ${authorName}`, since, `${authorName} asked your review on ${n}`);
  }
  if (!my) return review(`Review ${n} for ${authorName}`, since, `${authorName} asked your review on ${n}`);
  if (inProgress(my)) return review(`Finish your review of ${n}`, my.submittedAt, `Your review of ${n} isn't finished`);
  return {
    assessment: { ball: [people.id(author)], state: "waiting", since: my.submittedAt, line: `${n} is back with ${authorName}` },
    status: { label: `with ${authorName}`, tone: "active" },
  };
}

/** The log entries a PR gives: opened, reviews, comments, pushes, CI, merged. */
export function prEvents(pr: GhPr, itemId: string, people: People): Event[] {
  isBot = people.bot ?? (() => false);
  const n = `#${pr.number}`;
  const events: Event[] = [];
  const add = (at: string | undefined | null, login: string | "ci", text: string, extra: Partial<Event> = {}) => {
    if (!at) return;
    events.push({ id: `${itemId}@${at}:${events.length}`, itemId, source: "github", at, who: login === "ci" ? "ci" : people.id(login), text, ...extra });
  };
  add(pr.createdAt, pr.author.login, `opened ${n}`, { routine: true });
  for (const r of pr.reviews) {
    if (!human(r.author) || r.state === "PENDING" || r.state === "DISMISSED") continue;
    const body = (r.body ?? "").trim();
    if (r.state === "APPROVED") add(r.submittedAt, r.author!.login, `approved ${n}`, { tone: "good" });
    else if (r.state === "CHANGES_REQUESTED") add(r.submittedAt, r.author!.login, `asked for changes on ${n}${quote(body)}`);
    else add(r.submittedAt, r.author!.login, body ? `reviewed ${n}${quote(body)}` : `left a comment on ${n}`);
  }
  for (const c of pr.comments) if (human(c.author)) add(c.createdAt, c.author!.login, `commented on ${n}${quote(c.body ?? "")}`);
  // Commits within 15 minutes of each other count as one push.
  const dates = pr.commits.map((c) => c.committedDate).sort();
  let group: string[] = [];
  const flush = () => { if (group.length) add(group.at(-1), pr.author.login, `pushed ${group.length === 1 ? "a commit" : `${group.length} commits`} to ${n}`); group = []; };
  for (const d of dates) {
    if (group.length && Date.parse(d) - Date.parse(group.at(-1)!) > 15 * 60_000) flush();
    group.push(d);
  }
  flush();
  const ci = ciState(pr.statusCheckRollup);
  if (ci.state === "FAILURE") add(ci.failedAt, "ci", `${n} failed${ci.failedName ? `: ${ci.failedName}` : ""}`, { tone: "bad" });
  if (pr.state === "MERGED") add(pr.mergedAt, pr.mergedBy?.login ?? pr.author.login, `merged ${n}`, { routine: true });
  return events;
}

function quote(body: string): string {
  const line = body.replace(/\s+/g, " ").trim();
  if (!line) return "";
  return `: “${line.length > 90 ? `${line.slice(0, 88)}…` : line}”`;
}
