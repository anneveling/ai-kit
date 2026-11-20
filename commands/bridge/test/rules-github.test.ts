import { test } from "node:test";
import assert from "node:assert/strict";
import { assessPr, storyKeyOf, type GhPr } from "../src/rules/github.ts";

const ME = "ghost";
const NOW = new Date("2026-11-20T12:00:00Z");
const h = (hoursAgo: number) => new Date(NOW.getTime() - hoursAgo * 3_600_000).toISOString();
const who = { id: (login: string) => login, name: (login: string) => login }; // logins are the people here

function pr(over: Partial<GhPr> = {}): GhPr {
  return {
    number: 812, title: "Retry failed payouts", url: "https://github.com/acme/payments/pull/812",
    repo: "acme/payments", author: { login: ME }, isDraft: false, state: "OPEN",
    reviewDecision: "", reviewRequests: [], reviews: [], statusCheckRollup: [],
    createdAt: h(48), updatedAt: h(1), mergeable: "MERGEABLE", mergeStateStatus: "CLEAN",
    headRefName: "ghost/ac-1636-retries", commits: [{ committedDate: h(30) }], comments: [],
    ...over,
  };
}
const check = (conclusion: string, status = "COMPLETED", completedAt = h(2)) =>
  ({ name: "test", workflowName: "CI", status, conclusion, completedAt, startedAt: h(3) });
const review = (login: string, state: string, hoursAgo: number, body = "looks good") =>
  ({ author: { login }, state, submittedAt: h(hoursAgo), body });
const run = (p: GhPr) => assessPr(p, ME, NOW, who);

test("my PR, CI failing → me, fix", () => {
  const a = run(pr({ reviewRequests: ["toby"], statusCheckRollup: [check("FAILURE", "COMPLETED", h(0.5))] }));
  assert.equal(a.assessment.state, "your_move");
  assert.deepEqual(a.assessment.ball, ["me", "toby"]);
  assert.equal(a.assessment.next?.verb, "fix");
  assert.equal(a.assessment.since, h(0.5));
  assert.equal(a.assessment.stuck, undefined);
  assert.equal(a.status.label, "CI ✗");
});

test("CI red on an approved PR is stuck on me", () => {
  const a = run(pr({ reviews: [review("toby", "APPROVED", 2)], statusCheckRollup: [check("FAILURE")] }));
  assert.equal(a.assessment.stuck, "ci_red_approved");
  assert.match(a.assessment.line, /CI failed on #812 after toby approved it/);
});

test("my PR, changes requested → me, address", () => {
  const a = run(pr({ reviews: [review("toby", "CHANGES_REQUESTED", 3)] }));
  assert.equal(a.assessment.next?.verb, "address");
  assert.equal(a.assessment.since, h(3));
  assert.match(a.assessment.line, /toby asked for changes on #812/);
});

test("my PR, a submitted comment review since my last push → me, address", () => {
  const a = run(pr({ commits: [{ committedDate: h(10) }], reviews: [review("toby", "COMMENTED", 3, "a few questions")] }));
  assert.equal(a.assessment.next?.verb, "address");
});

test("my PR, a PR comment since my last push → me, address", () => {
  const a = run(pr({ reviewRequests: ["toby"], commits: [{ committedDate: h(10) }], comments: [{ author: { login: "sam" }, createdAt: h(2), body: "why 3 s?" }] }));
  assert.equal(a.assessment.next?.verb, "address");
  assert.match(a.assessment.line, /sam commented on #812/);
});

test("comments older than my last push don't count", () => {
  const a = run(pr({ reviewRequests: ["toby"], commits: [{ committedDate: h(1) }], comments: [{ author: { login: "sam" }, createdAt: h(2), body: "x" }] }));
  assert.equal(a.assessment.state, "waiting");
});

test("my PR, approved + CI green + mergeable → me, merge", () => {
  const a = run(pr({ reviewDecision: "APPROVED", reviews: [review("toby", "APPROVED", 2)], statusCheckRollup: [check("SUCCESS")] }));
  assert.equal(a.assessment.next?.verb, "merge");
  assert.equal(a.assessment.since, h(2));
  assert.equal(a.status.label, "ready to merge");
});

test("an empty reviewDecision with an approval still counts as approved (pr-watch gotcha)", () => {
  const a = run(pr({ reviewDecision: "", reviews: [review("toby", "APPROVED", 2)], statusCheckRollup: [check("SUCCESS")] }));
  assert.equal(a.assessment.next?.verb, "merge");
});

test("approved but conflicting → me, merge after resolving", () => {
  const a = run(pr({ reviews: [review("toby", "APPROVED", 2)], mergeable: "CONFLICTING", mergeStateStatus: "DIRTY" }));
  assert.equal(a.assessment.next?.verb, "merge");
  assert.match(a.assessment.next?.label ?? "", /conflicts/);
});

test("approved with CI running → in motion", () => {
  const a = run(pr({ reviews: [review("toby", "APPROVED", 2)], statusCheckRollup: [check("", "IN_PROGRESS")] }));
  assert.equal(a.assessment.state, "in_motion");
  assert.deepEqual(a.assessment.ball, ["ci"]);
});

test("my PR waiting on requested reviewers → them; nudge only after 48h", () => {
  const fresh = run(pr({ reviewRequests: ["toby"], commits: [{ committedDate: h(5) }] }));
  assert.equal(fresh.assessment.state, "waiting");
  assert.deepEqual(fresh.assessment.ball, ["toby"]);
  assert.equal(fresh.assessment.next, undefined);
  assert.match(fresh.assessment.line, /#812 is with toby for review/);
  assert.doesNotMatch(fresh.assessment.line, /reviewing/);
  const old = run(pr({ reviewRequests: ["toby"], commits: [{ committedDate: h(50) }], createdAt: h(60) }));
  assert.equal(old.assessment.state, "waiting");
  assert.equal(old.assessment.next?.verb, "nudge");
});

test("a reviewer mid-review (single inline comment, empty body) keeps the ball (pr-watch gotcha)", () => {
  const a = run(pr({ reviews: [review("toby", "COMMENTED", 1, "")] }));
  assert.equal(a.assessment.state, "waiting");
  assert.deepEqual(a.assessment.ball, ["toby"]);
});

test("my own reviews on my PR don't count", () => {
  const a = run(pr({ reviewRequests: ["toby"], reviews: [review(ME, "COMMENTED", 1, "note to self")] }));
  assert.equal(a.assessment.state, "waiting");
});

test("my PR with no reviewers and no reviews → me, ask for a review", () => {
  const a = run(pr());
  assert.equal(a.assessment.state, "your_move");
  assert.match(a.assessment.next?.label ?? "", /review/);
});

test("my draft with no reviewers → quiet", () => {
  const a = run(pr({ isDraft: true }));
  assert.equal(a.assessment.state, "quiet");
  assert.equal(a.status.label, "draft");
});

test("my draft with a reviewer → waiting on them", () => {
  const a = run(pr({ isDraft: true, reviewRequests: ["toby"] }));
  assert.equal(a.assessment.state, "waiting");
});

test("CI running on my PR → in motion, ball with CI and reviewers", () => {
  const a = run(pr({ reviewRequests: ["toby"], statusCheckRollup: [check("", "IN_PROGRESS")] }));
  assert.equal(a.assessment.state, "in_motion");
  assert.deepEqual(a.assessment.ball, ["ci", "toby"]);
});

test("someone's PR, my review requested → me, review", () => {
  const a = run(pr({ author: { login: "maya" }, reviewRequests: [ME], commits: [{ committedDate: h(3) }] }));
  assert.equal(a.assessment.state, "your_move");
  assert.equal(a.assessment.next?.verb, "review");
  assert.equal(a.assessment.since, h(3));
  assert.match(a.assessment.line, /maya asked your review on #812/);
});

test("someone's PR, I already reviewed and I'm off the requests → waiting on the author", () => {
  const a = run(pr({ author: { login: "maya" }, reviews: [review(ME, "APPROVED", 2)] }));
  assert.equal(a.assessment.state, "waiting");
  assert.deepEqual(a.assessment.ball, ["maya"]);
  assert.equal(a.assessment.next, undefined);
});

test("someone's PR, my review is a single inline comment → still my move, finish it", () => {
  const a = run(pr({ author: { login: "maya" }, reviews: [review(ME, "COMMENTED", 2, "")] }));
  assert.equal(a.assessment.state, "your_move");
  assert.match(a.assessment.next?.label ?? "", /Finish your review/);
});

test("someone's PR, re-requested after my review → me, review again", () => {
  const a = run(pr({ author: { login: "maya" }, reviewRequests: [ME], reviews: [review(ME, "CHANGES_REQUESTED", 20)], commits: [{ committedDate: h(2) }] }));
  assert.equal(a.assessment.next?.verb, "review");
  assert.match(a.assessment.next?.label ?? "", /Re-review/);
});

test("merged → quiet and done", () => {
  const a = run(pr({ state: "MERGED", mergedAt: h(20) }));
  assert.equal(a.assessment.state, "quiet");
  assert.equal(a.status.tone, "done");
  assert.equal(a.status.label, "merged");
});

test("story key from the title, else the branch", () => {
  assert.equal(storyKeyOf({ title: "docs(AC-2513): accepted list", headRefName: "x" }), "AC-2513");
  assert.equal(storyKeyOf({ title: "Fix things", headRefName: "anne/bg-1636-retries" }), "BG-1636");
  assert.equal(storyKeyOf({ title: "Bump UTF-8 handling", headRefName: "deps" }, ["BG"]), undefined);
  assert.equal(storyKeyOf({ title: "nothing here", headRefName: "main" }), undefined);
});

test("comments by bots and apps don't ask anything of me", () => {
  const people = { ...who, bot: (l: string) => l === "github-actions" || l === "shopify" };
  const a = assessPr(pr({ reviewRequests: ["toby"], comments: [
    { author: { login: "github-actions" }, createdAt: h(1), body: "Preview deployed" },
    { author: { login: "shopify" }, createdAt: h(1), body: "Oxygen deployed" },
    { author: { login: "renovate[bot]" }, createdAt: h(1), body: "x" },
  ] }), ME, NOW, people);
  assert.equal(a.assessment.state, "waiting");
});
