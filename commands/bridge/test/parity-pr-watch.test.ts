// Phase 2 done check, as a test: every PR pr-watch puts in YOUR TURN is "your move" in bridge.
// Runs pr-watch's own ballInCourt on the same made-up PRs. Remove when pr-watch retires.
//
// Known, intended differences (the spec decides; pr-watch is the check):
// - Approved with CI still running: pr-watch says merge; bridge says in motion,
//   and turns to merge once CI is green. Nothing to do until then.
// - Bridge may also say "your move" where pr-watch doesn't: a PR comment (not a
//   review) since my last push asks me to answer it; and my draft with reviewers
//   but failing CI is mine to fix (pr-watch gives drafts to the reviewers only).

import { test } from "node:test";
import assert from "node:assert/strict";
// @ts-expect-error: pr-watch is plain JS without types
import { ballInCourt, ciSummary, isHiddenDraft } from "../../pr-watch/lib.mjs";
import { assessPr, type GhPr } from "../src/rules/github.ts";

const ME = "ghost";
const NOW = new Date("2026-11-20T12:00:00Z");
const h = (hoursAgo: number) => new Date(NOW.getTime() - hoursAgo * 3_600_000).toISOString();
const people = { id: (l: string) => (l === ME ? "me" : l), name: (l: string) => l };
const review = (login: string, state: string, hoursAgo: number, body = "ok") => ({ author: { login }, state, submittedAt: h(hoursAgo), body });
const check = (conclusion: string, status = "COMPLETED") => ({ name: "test", workflowName: "CI", status, conclusion, startedAt: h(3), completedAt: h(2) });

function pr(over: Partial<GhPr>): GhPr {
  return {
    number: 1, title: "t", url: "u", repo: "acme/web", author: { login: ME }, isDraft: false, state: "OPEN",
    reviewDecision: "", reviewRequests: [], reviews: [], statusCheckRollup: [], createdAt: h(60), updatedAt: h(1),
    mergeable: "MERGEABLE", mergeStateStatus: "CLEAN", headRefName: "b", commits: [{ committedDate: h(30) }], comments: [], ...over,
  };
}

// pr-watch's shape, as its poll.mjs builds it (latestReviews leaves out the viewer).
function toPrWatch(p: GhPr) {
  const latest = new Map<string, ReturnType<typeof review>>();
  for (const r of p.reviews) {
    const login = r.author!.login;
    if (login === ME || r.state === "DISMISSED") continue;
    if (!latest.has(login) || r.submittedAt > latest.get(login)!.submittedAt) latest.set(login, r as ReturnType<typeof review>);
  }
  return {
    ...p, role: p.author.login === ME ? "author" : "reviewer", ciStatus: ciSummary(p.statusCheckRollup),
    latestReviews: [...latest.values()].map((r) => ({ login: r.author.login, state: r.state, submittedAt: r.submittedAt, hasBody: Boolean(r.body.trim()) })),
  };
}

const SCENARIOS: [string, GhPr][] = [
  ["mine, CI failing", pr({ reviewRequests: ["toby"], statusCheckRollup: [check("FAILURE")] })],
  ["mine, approved, CI failing", pr({ reviews: [review("toby", "APPROVED", 2)], statusCheckRollup: [check("FAILURE")] })],
  ["mine, changes requested", pr({ reviews: [review("toby", "CHANGES_REQUESTED", 3)] })],
  ["mine, comment review after push", pr({ reviews: [review("toby", "COMMENTED", 3, "questions")] })],
  ["mine, comment review before push", pr({ commits: [{ committedDate: h(1) }], reviews: [review("toby", "COMMENTED", 3, "questions")] })],
  ["mine, approved + green", pr({ reviews: [review("toby", "APPROVED", 2)], statusCheckRollup: [check("SUCCESS")] })],
  ["mine, approved + conflicts", pr({ reviews: [review("toby", "APPROVED", 2)], mergeable: "CONFLICTING", mergeStateStatus: "DIRTY" })],
  ["mine, waiting on a reviewer", pr({ reviewRequests: ["toby"] })],
  ["mine, waiting, CI running", pr({ reviewRequests: ["toby"], statusCheckRollup: [check("", "IN_PROGRESS")] })],
  ["mine, reviewer mid-review", pr({ reviews: [review("toby", "COMMENTED", 1, "")] })],
  ["mine, one done, one requested", pr({ reviewRequests: ["maya"], reviews: [review("toby", "CHANGES_REQUESTED", 2)] })],
  ["mine, no reviewers", pr({})],
  ["mine, draft", pr({ isDraft: true })],
  ["mine, draft with reviewer", pr({ isDraft: true, reviewRequests: ["toby"] })],
  ["theirs, review requested", pr({ author: { login: "maya" }, reviewRequests: [ME] })],
  ["theirs, re-requested", pr({ author: { login: "maya" }, reviewRequests: [ME], reviews: [review(ME, "CHANGES_REQUESTED", 20)] })],
  ["theirs, I approved", pr({ author: { login: "maya" }, reviews: [review(ME, "APPROVED", 2)] })],
  ["theirs, my single comment", pr({ author: { login: "maya" }, reviews: [review(ME, "COMMENTED", 2, "")] })],
  ["theirs, I asked for changes", pr({ author: { login: "maya" }, reviews: [review(ME, "CHANGES_REQUESTED", 2)] })],
];

for (const [name, p] of SCENARIOS) {
  test(`parity: ${name}`, () => {
    const pw = toPrWatch(p);
    // pr-watch leaves your own drafts without reviewers off the dashboard.
    const prWatchYourTurn = !isHiddenDraft(pw) && (ballInCourt(pw, ME) as Set<string>).has(ME);
    const bridgeYourMove = assessPr(p, ME, NOW, people).assessment.state === "your_move";
    if (prWatchYourTurn) assert.ok(bridgeYourMove, "pr-watch says YOUR TURN, bridge doesn't say your move");
    else assert.equal(bridgeYourMove, false, "bridge says your move where pr-watch doesn't; add it to the known differences above if intended");
  });
}

test("known difference: approved with CI running is in motion, then merge once green", () => {
  const running = pr({ reviews: [review("toby", "APPROVED", 2)], statusCheckRollup: [check("", "IN_PROGRESS")] });
  assert.equal((ballInCourt(toPrWatch(running), ME) as Set<string>).has(ME), true);
  assert.equal(assessPr(running, ME, NOW, people).assessment.state, "in_motion");
  const green = pr({ reviews: [review("toby", "APPROVED", 2)], statusCheckRollup: [check("SUCCESS")] });
  assert.equal(assessPr(green, ME, NOW, people).assessment.next?.verb, "merge");
});

test("known difference: a PR comment since my last push is my move in bridge only", () => {
  const p = pr({ reviewRequests: ["toby"], comments: [{ author: { login: "sam" }, createdAt: h(2), body: "why?" }] });
  assert.equal((ballInCourt(toPrWatch(p), ME) as Set<string>).has(ME), false);
  assert.equal(assessPr(p, ME, NOW, people).assessment.state, "your_move");
});

test("known difference: my draft with reviewers and failing CI is mine to fix in bridge only", () => {
  const p = pr({ isDraft: true, reviewRequests: ["toby"], statusCheckRollup: [check("FAILURE")] });
  assert.equal((ballInCourt(toPrWatch(p), ME) as Set<string>).has(ME), false);
  assert.equal(assessPr(p, ME, NOW, people).assessment.next?.verb, "fix");
});
