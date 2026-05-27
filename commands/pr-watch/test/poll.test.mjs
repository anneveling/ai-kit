import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildPayload, ciSummary, computeEvents, computeStopTime, diffPr,
  latestMyReview, ballInCourt, bicSince, bouncesCount,
  ageStr, ageMarker, ciChip, mergeChip, reviewChip, priorityChip,
} from "../lib.mjs";

// ── buildPayload ──────────────────────────────────────────────────────────────

const META = { schemaVersion: 1, pollerVersion: "0.12.0" };

test("buildPayload: returns correct envelope shape", () => {
  const prs = [{ url: "https://github.com/a/b/pull/1" }];
  const payload = buildPayload(prs, "alice", META);
  assert.equal(payload.schemaVersion, 1);
  assert.equal(payload.pollerVersion, "0.12.0");
  assert.equal(payload.viewer, "alice");
  assert.match(payload.generatedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(payload.prs, prs);
});

test("buildPayload: accepts empty prs and null viewer (reset case)", () => {
  const payload = buildPayload([], null, META);
  assert.deepEqual(payload.prs, []);
  assert.equal(payload.viewer, null);
});

test("buildPayload: schemaVersion and pollerVersion come from the meta argument", () => {
  const payload = buildPayload([], "bob", { schemaVersion: 2, pollerVersion: "1.0.0" });
  assert.equal(payload.schemaVersion, 2);
  assert.equal(payload.pollerVersion, "1.0.0");
});

// ── computeEvents ─────────────────────────────────────────────────────────────

// Shared fixtures
const URL1 = "https://github.com/acme/repo/pull/1";
const URL2 = "https://github.com/acme/repo/pull/2";
const now = new Date("2024-01-15T14:00:00Z");

function makePr(url, overrides = {}) {
  return {
    number: 1, title: "Fix bug", url, repo: "acme/repo", role: "author",
    reviewDecision: "REVIEW_REQUIRED", isDraft: false, ciStatus: "SUCCESS",
    latestReviews: [], updatedAt: "2024-01-15T09:00:00Z", _searchUpdatedAt: "2024-01-14T10:00:00Z",
    ...overrides,
  };
}

function makeSummary(url, updatedAt = "2024-01-15T09:00:00Z") {
  return { url, updatedAt, role: "author", repository: { nameWithOwner: "acme/repo" } };
}

// Day-2 startup: existing state, isFirstRun=false (simulates the old buggy behavior)
test("computeEvents: isFirstRun=false with stale prevState fires spurious events (demonstrates the bug)", () => {
  const prev = makePr(URL1, { _searchUpdatedAt: "2024-01-14T10:00:00Z" });
  const enriched = makePr(URL1, { ciStatus: "FAILURE", _searchUpdatedAt: "2024-01-15T09:00:00Z" });
  const summaries = [makeSummary(URL1)];
  const enrichedMap = { [URL1]: enriched };
  const prevState = { [URL1]: prev };

  const { events } = computeEvents(summaries, enrichedMap, prevState, false, now);
  assert.equal(events.length, 1);
  assert.equal(events[0].event, "changed");
});

// Day-2 startup: same scenario but isFirstRun=true (the fix) — no events
test("computeEvents: isFirstRun=true suppresses all events on startup regardless of stale prevState", () => {
  const prev = makePr(URL1, { _searchUpdatedAt: "2024-01-14T10:00:00Z" });
  const enriched = makePr(URL1, { ciStatus: "FAILURE", _searchUpdatedAt: "2024-01-15T09:00:00Z" });
  const summaries = [makeSummary(URL1)];
  const enrichedMap = { [URL1]: enriched };
  const prevState = { [URL1]: prev };

  const { events } = computeEvents(summaries, enrichedMap, prevState, true, now);
  assert.equal(events.length, 0);
});

// Day-2 startup: closed PRs in stale state should also be suppressed
test("computeEvents: isFirstRun=true suppresses closed events for PRs absent from current summaries", () => {
  const prev = makePr(URL1);
  const summaries = []; // PR not in current results
  const { events } = computeEvents(summaries, {}, { [URL1]: prev }, true, now);
  assert.equal(events.length, 0);
});

// Normal poll (not first run): new PR appears → "new" event
test("computeEvents: isFirstRun=false emits new event for PR absent from prevState", () => {
  const enriched = makePr(URL1);
  const summaries = [makeSummary(URL1)];
  const { events } = computeEvents(summaries, { [URL1]: enriched }, {}, false, now);
  assert.equal(events.length, 1);
  assert.equal(events[0].event, "new");
  assert.equal(events[0].url, URL1);
});

// Normal poll: PR disappears → "closed" event
test("computeEvents: isFirstRun=false emits closed event for PR absent from current summaries", () => {
  const prev = makePr(URL1);
  const summaries = [];
  const { events } = computeEvents(summaries, {}, { [URL1]: prev }, false, now);
  assert.equal(events.length, 1);
  assert.equal(events[0].event, "closed");
  assert.equal(events[0].url, URL1);
});

// nextState is always populated regardless of isFirstRun
test("computeEvents: nextState always reflects current enriched PRs", () => {
  const enriched = makePr(URL1);
  const summaries = [makeSummary(URL1)];
  const { nextState } = computeEvents(summaries, { [URL1]: enriched }, {}, true, now);
  assert.ok(nextState[URL1]);
  assert.equal(nextState[URL1]._searchUpdatedAt, "2024-01-15T09:00:00Z");
});

// ── ciSummary ─────────────────────────────────────────────────────────────────

test("ciSummary: null when no checks", () => {
  assert.equal(ciSummary(null), null);
  assert.equal(ciSummary([]), null);
});

test("ciSummary: FAILURE when any check failed", () => {
  assert.equal(ciSummary([{ conclusion: "SUCCESS" }, { conclusion: "FAILURE" }]), "FAILURE");
  assert.equal(ciSummary([{ conclusion: "ACTION_REQUIRED" }]), "FAILURE");
  assert.equal(ciSummary([{ status: "ERROR" }]), "FAILURE");
});

test("ciSummary: PENDING when any check is in progress", () => {
  assert.equal(ciSummary([{ conclusion: "SUCCESS" }, { status: "IN_PROGRESS" }]), "PENDING");
  assert.equal(ciSummary([{ status: "QUEUED" }]), "PENDING");
});

test("ciSummary: SUCCESS when all checks passed", () => {
  assert.equal(ciSummary([{ conclusion: "SUCCESS" }, { conclusion: "NEUTRAL" }]), "SUCCESS");
  assert.equal(ciSummary([{ conclusion: "SKIPPED" }, { conclusion: "COMPLETED" }]), "SUCCESS");
});

test("ciSummary: uses status over conclusion when both present", () => {
  assert.equal(ciSummary([{ status: "IN_PROGRESS", conclusion: "SUCCESS" }]), "PENDING");
});

// ── diffPr ────────────────────────────────────────────────────────────────────

const base = {
  reviewDecision: "REVIEW_REQUIRED",
  isDraft: false,
  ciStatus: "SUCCESS",
  latestReviews: [{ login: "maya", state: "APPROVED" }],
};

test("diffPr: null when nothing changed", () => {
  assert.equal(diffPr(base, { ...base }), null);
});

test("diffPr: detects reviewDecision change", () => {
  const changes = diffPr(base, { ...base, reviewDecision: "APPROVED" });
  assert.deepEqual(changes.reviewDecision, { from: "REVIEW_REQUIRED", to: "APPROVED" });
  assert.equal(Object.keys(changes).length, 1);
});

test("diffPr: detects ciStatus change", () => {
  const changes = diffPr(base, { ...base, ciStatus: "FAILURE" });
  assert.deepEqual(changes.ciStatus, { from: "SUCCESS", to: "FAILURE" });
});

test("diffPr: detects isDraft change", () => {
  const changes = diffPr(base, { ...base, isDraft: true });
  assert.deepEqual(changes.isDraft, { from: false, to: true });
});

test("diffPr: detects latestReviews change", () => {
  const updated = { ...base, latestReviews: [{ login: "maya", state: "CHANGES_REQUESTED" }] };
  const changes = diffPr(base, updated);
  assert.ok(changes.latestReviews);
  assert.deepEqual(changes.latestReviews.from, base.latestReviews);
  assert.deepEqual(changes.latestReviews.to, updated.latestReviews);
});

test("diffPr: review order does not matter", () => {
  const a = { ...base, latestReviews: [{ login: "maya", state: "APPROVED" }, { login: "alex", state: "APPROVED" }] };
  const b = { ...base, latestReviews: [{ login: "alex", state: "APPROVED" }, { login: "maya", state: "APPROVED" }] };
  assert.equal(diffPr(a, b), null);
});

test("diffPr: detects multiple changes at once", () => {
  const changes = diffPr(base, { ...base, ciStatus: "FAILURE", isDraft: true });
  assert.ok(changes.ciStatus);
  assert.ok(changes.isDraft);
  assert.equal(Object.keys(changes).length, 2);
});

test("diffPr: ignores UNKNOWN→settled transitions for mergeable (flicker guard)", () => {
  const prev = { ...base, mergeable: "UNKNOWN", mergeStateStatus: "UNKNOWN" };
  const next = { ...base, mergeable: "MERGEABLE", mergeStateStatus: "CLEAN" };
  assert.equal(diffPr(prev, next), null);
});

test("diffPr: ignores settled→UNKNOWN transitions for mergeable (flicker guard)", () => {
  const prev = { ...base, mergeable: "MERGEABLE", mergeStateStatus: "CLEAN" };
  const next = { ...base, mergeable: "UNKNOWN", mergeStateStatus: "UNKNOWN" };
  assert.equal(diffPr(prev, next), null);
});

test("diffPr: detects real mergeStateStatus change (CLEAN → DIRTY)", () => {
  const prev = { ...base, mergeable: "MERGEABLE", mergeStateStatus: "CLEAN" };
  const next = { ...base, mergeable: "CONFLICTING", mergeStateStatus: "DIRTY" };
  const changes = diffPr(prev, next);
  assert.ok(changes.mergeable);
  assert.ok(changes.mergeStateStatus);
  assert.deepEqual(changes.mergeStateStatus, { from: "CLEAN", to: "DIRTY" });
});

// ── computeStopTime ───────────────────────────────────────────────────────────

test("computeStopTime: HOURS sets stop to now + N hours", () => {
  const now = new Date("2024-01-15T10:00:00");
  const stop = computeStopTime({ HOURS: "2" }, now);
  assert.equal(stop.getTime(), now.getTime() + 2 * 3600_000);
});

test("computeStopTime: STOP_AT sets stop to that clock time today", () => {
  const now = new Date("2024-01-15T10:00:00");
  const stop = computeStopTime({ STOP_AT: "17:30" }, now);
  assert.equal(stop.getHours(), 17);
  assert.equal(stop.getMinutes(), 30);
});

test("computeStopTime: defaults to 18:00 when started during work hours", () => {
  const now = new Date("2024-01-15T09:00:00");
  const stop = computeStopTime({}, now);
  assert.equal(stop.getHours(), 18);
  assert.equal(stop.getMinutes(), 0);
});

test("computeStopTime: defaults to +4h when started outside work hours", () => {
  const now = new Date("2024-01-15T20:00:00");
  const stop = computeStopTime({}, now);
  assert.equal(stop.getTime(), now.getTime() + 4 * 3600_000);
});

test("computeStopTime: HOURS takes precedence over STOP_AT", () => {
  const now = new Date("2024-01-15T10:00:00");
  const stop = computeStopTime({ HOURS: "1", STOP_AT: "17:30" }, now);
  assert.equal(stop.getTime(), now.getTime() + 3600_000);
});

// ── latestMyReview ────────────────────────────────────────────────────────────

test("latestMyReview: returns null when no reviews", () => {
  const pr = { reviews: [] };
  assert.equal(latestMyReview(pr, "alice"), null);
});

test("latestMyReview: returns the most recent non-DISMISSED review by me", () => {
  const pr = {
    reviews: [
      { author: { login: "alice" }, state: "COMMENTED", submittedAt: "2024-01-10T00:00:00Z" },
      { author: { login: "alice" }, state: "APPROVED", submittedAt: "2024-01-12T00:00:00Z" },
      { author: { login: "bob" },   state: "APPROVED", submittedAt: "2024-01-13T00:00:00Z" },
    ],
  };
  const r = latestMyReview(pr, "alice");
  assert.equal(r.state, "APPROVED");
  assert.equal(r.submittedAt, "2024-01-12T00:00:00Z");
});

test("latestMyReview: skips DISMISSED reviews", () => {
  const pr = {
    reviews: [
      { author: { login: "alice" }, state: "DISMISSED", submittedAt: "2024-01-12T00:00:00Z" },
      { author: { login: "alice" }, state: "COMMENTED", submittedAt: "2024-01-10T00:00:00Z" },
    ],
  };
  const r = latestMyReview(pr, "alice");
  assert.equal(r.state, "COMMENTED");
});

test("latestMyReview: returns null when only DISMISSED reviews by me", () => {
  const pr = {
    reviews: [
      { author: { login: "alice" }, state: "DISMISSED", submittedAt: "2024-01-12T00:00:00Z" },
    ],
  };
  assert.equal(latestMyReview(pr, "alice"), null);
});

// ── ballInCourt ───────────────────────────────────────────────────────────────

function makeBicPr(overrides = {}) {
  return {
    author: { login: "alice" },
    isDraft: false,
    reviewRequests: [],
    latestReviews: [],
    reviewDecision: "REVIEW_REQUIRED",
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
    role: "author",
    reviews: [],
    ...overrides,
  };
}

test("ballInCourt: draft PR is always author's ball", () => {
  const pr = makeBicPr({ isDraft: true, reviewRequests: ["bob"] });
  const bic = ballInCourt(pr, "alice");
  assert.ok(bic.has("alice"));
  assert.ok(!bic.has("bob")); // pending request ignored for drafts
});

test("ballInCourt: pending review request → that reviewer's ball", () => {
  const pr = makeBicPr({ reviewRequests: ["bob", "carol"] });
  const bic = ballInCourt(pr, "alice");
  assert.ok(bic.has("bob"));
  assert.ok(bic.has("carol"));
});

test("ballInCourt: unaddressed CHANGES_REQUESTED → author's ball", () => {
  const pr = makeBicPr({
    reviewDecision: "CHANGES_REQUESTED",
    latestReviews: [{ login: "bob", state: "CHANGES_REQUESTED" }],
    reviewRequests: [],
  });
  const bic = ballInCourt(pr, "alice");
  assert.ok(bic.has("alice"));
  assert.ok(!bic.has("bob"));
});

test("ballInCourt: CHANGES_REQUESTED but reviewer is re-requested → not author's fault yet", () => {
  // bob requested changes, then alice re-requested bob → ball is with bob
  const pr = makeBicPr({
    reviewDecision: "CHANGES_REQUESTED",
    latestReviews: [{ login: "bob", state: "CHANGES_REQUESTED" }],
    reviewRequests: ["bob"], // re-requested
  });
  const bic = ballInCourt(pr, "alice");
  assert.ok(bic.has("bob")); // pending re-request
  assert.ok(!bic.has("alice")); // blocker is re-requested, not unaddressed
});

test("ballInCourt: APPROVED + no pending re-requests → author must merge", () => {
  const pr = makeBicPr({
    reviewDecision: "APPROVED",
    latestReviews: [{ login: "bob", state: "APPROVED" }],
    reviewRequests: [],
  });
  const bic = ballInCourt(pr, "alice");
  assert.ok(bic.has("alice"));
});

test("ballInCourt: DIRTY → author has conflicts to fix", () => {
  const pr = makeBicPr({ mergeStateStatus: "DIRTY" });
  const bic = ballInCourt(pr, "alice");
  assert.ok(bic.has("alice"));
});

test("ballInCourt: BEHIND + APPROVED → author must rebase", () => {
  const pr = makeBicPr({
    mergeStateStatus: "BEHIND",
    reviewDecision: "APPROVED",
    latestReviews: [{ login: "bob", state: "APPROVED" }],
  });
  const bic = ballInCourt(pr, "alice");
  assert.ok(bic.has("alice"));
});

test("ballInCourt: no engagement at all → author needs to add reviewers", () => {
  const pr = makeBicPr({ reviewRequests: [], latestReviews: [], reviewDecision: "REVIEW_REQUIRED" });
  const bic = ballInCourt(pr, "alice");
  assert.ok(bic.has("alice"));
});

test("ballInCourt: reviewer role with no prior review → reviewer has the ball", () => {
  const pr = makeBicPr({
    role: "reviewer",
    author: { login: "bob" },
    reviewRequests: [],
    latestReviews: [],
    reviews: [],
  });
  const bic = ballInCourt(pr, "alice");
  assert.ok(bic.has("alice"));
});

test("ballInCourt: reviewer role after CHANGES_REQUESTED by me → not my ball anymore", () => {
  const pr = makeBicPr({
    role: "reviewer",
    author: { login: "bob" },
    reviewRequests: [],
    latestReviews: [{ login: "alice", state: "CHANGES_REQUESTED" }],
    reviews: [{ author: { login: "alice" }, state: "CHANGES_REQUESTED", submittedAt: "2024-01-10T00:00:00Z" }],
  });
  const bic = ballInCourt(pr, "alice");
  // alice already gave verdict — ball is with author bob
  assert.ok(!bic.has("alice"));
  assert.ok(bic.has("bob")); // alice's CHANGES_REQUESTED is unaddressed
});

test("ballInCourt: multi-reviewer — one reviewer requests changes, other reviewer still has ball", () => {
  // alice is reviewer; wspringer already requested changes (unaddressed)
  // → alice's ball is independent of wspringer's changes request
  const pr = makeBicPr({
    role: "reviewer",
    author: { login: "bob" },
    reviewRequests: [],
    latestReviews: [{ login: "wspringer", state: "CHANGES_REQUESTED" }],
    reviews: [
      { author: { login: "wspringer" }, state: "CHANGES_REQUESTED", submittedAt: "2024-01-10T00:00:00Z" },
    ],
  });
  const bic = ballInCourt(pr, "alice");
  // alice (reviewer role, no review yet) still has the ball
  assert.ok(bic.has("alice"));
  // bob (author) has the ball too because of wspringer's unaddressed CR
  assert.ok(bic.has("bob"));
});

test("ballInCourt: COMMENTED reviewer is mid-review (ball stays with them)", () => {
  const pr = makeBicPr({
    role: "author",
    latestReviews: [{ login: "bob", state: "COMMENTED" }],
    reviewRequests: [],
  });
  const bic = ballInCourt(pr, "alice");
  assert.ok(bic.has("bob"));
});

test("ballInCourt: returns empty set when no author login", () => {
  const pr = { ...makeBicPr(), author: null };
  assert.equal(ballInCourt(pr, "alice").size, 0);
});

// ── bicSince ──────────────────────────────────────────────────────────────────

test("bicSince: author + CHANGES_REQUESTED → blocker's submittedAt", () => {
  const pr = makeBicPr({
    author: { login: "alice" },
    reviewDecision: "CHANGES_REQUESTED",
    latestReviews: [{ login: "bob", state: "CHANGES_REQUESTED", submittedAt: "2024-01-10T12:00:00Z" }],
    reviewRequests: [],
  });
  assert.equal(bicSince(pr, "alice"), "2024-01-10T12:00:00Z");
});

test("bicSince: author + CHANGES_REQUESTED but re-requested → null (blocker is addressed)", () => {
  const pr = makeBicPr({
    author: { login: "alice" },
    reviewDecision: "CHANGES_REQUESTED",
    latestReviews: [{ login: "bob", state: "CHANGES_REQUESTED", submittedAt: "2024-01-10T12:00:00Z" }],
    reviewRequests: ["bob"], // re-requested → not a blocker
  });
  // All blockers are re-requested, so bicSince falls through to null
  assert.equal(bicSince(pr, "alice"), null);
});

test("bicSince: author + APPROVED → latest approval timestamp", () => {
  const pr = makeBicPr({
    author: { login: "alice" },
    reviewDecision: "APPROVED",
    latestReviews: [
      { login: "bob",   state: "APPROVED", submittedAt: "2024-01-08T00:00:00Z" },
      { login: "carol", state: "APPROVED", submittedAt: "2024-01-10T00:00:00Z" },
    ],
  });
  assert.equal(bicSince(pr, "alice"), "2024-01-10T00:00:00Z");
});

test("bicSince: author with no engagement → PR createdAt", () => {
  const pr = { ...makeBicPr({ author: { login: "alice" } }), createdAt: "2024-01-01T00:00:00Z" };
  assert.equal(bicSince(pr, "alice"), "2024-01-01T00:00:00Z");
});

test("bicSince: reviewer mid-review → their latest review submittedAt", () => {
  const pr = makeBicPr({
    author: { login: "bob" },
    role: "reviewer",
    reviews: [{ author: { login: "alice" }, state: "COMMENTED", submittedAt: "2024-01-09T00:00:00Z" }],
  });
  assert.equal(bicSince(pr, "alice"), "2024-01-09T00:00:00Z");
});

test("bicSince: reviewer with no prior review → null (don't know when requested)", () => {
  const pr = makeBicPr({ author: { login: "bob" }, role: "reviewer", reviews: [] });
  assert.equal(bicSince(pr, "alice"), null);
});

// ── bouncesCount ──────────────────────────────────────────────────────────────

test("bouncesCount: 0 when no reviews", () => {
  const pr = makeBicPr({ reviews: [] });
  assert.equal(bouncesCount(pr), 0);
});

test("bouncesCount: counts CHANGES_REQUESTED from non-author non-bot", () => {
  const pr = makeBicPr({
    author: { login: "alice" },
    reviews: [
      { author: { login: "bob" }, state: "CHANGES_REQUESTED", is_bot: false },
      { author: { login: "bob" }, state: "CHANGES_REQUESTED", is_bot: false },
      { author: { login: "carol" }, state: "APPROVED", is_bot: false },
    ],
  });
  assert.equal(bouncesCount(pr), 2);
});

test("bouncesCount: does not count CHANGES_REQUESTED from the author themselves", () => {
  const pr = makeBicPr({
    author: { login: "alice" },
    reviews: [
      { author: { login: "alice" }, state: "CHANGES_REQUESTED", is_bot: false },
    ],
  });
  assert.equal(bouncesCount(pr), 0);
});

test("bouncesCount: does not count bot reviews", () => {
  const pr = makeBicPr({
    author: { login: "alice" },
    reviews: [
      { author: { login: "dependabot", is_bot: true }, state: "CHANGES_REQUESTED" },
    ],
  });
  assert.equal(bouncesCount(pr), 0);
});

// ── ageStr ────────────────────────────────────────────────────────────────────

const T = (offsetMs) => new Date(Date.now() - offsetMs).toISOString();

test("ageStr: 'now' when under 1 minute", () => {
  assert.equal(ageStr(T(30_000)), "now");
});

test("ageStr: minutes when under 1 hour", () => {
  assert.equal(ageStr(T(90_000)), "1m");     // 1.5 min → floor 1
  assert.equal(ageStr(T(3540_000)), "59m");  // 59 min
});

test("ageStr: hours when under 1 day", () => {
  assert.equal(ageStr(T(3_600_000)), "1h");
  assert.equal(ageStr(T(82_800_000)), "23h"); // 23h
});

test("ageStr: days when >= 1 day", () => {
  assert.equal(ageStr(T(86_400_000)), "1d");
  assert.equal(ageStr(T(172_800_000)), "2d");
});

// ── ageMarker ─────────────────────────────────────────────────────────────────

test("ageMarker: 🥚 egg when under 1 hour", () => {
  const { cls, text } = ageMarker(T(1_800_000)); // 30 min
  assert.equal(cls, "age-young");
  assert.ok(text.startsWith("🥚"));
});

test("ageMarker: 🐣 hatching when 1h–6h", () => {
  const { cls, text } = ageMarker(T(3 * 3_600_000)); // 3h
  assert.equal(cls, "age-aging");
  assert.ok(text.startsWith("🐣"));
});

test("ageMarker: 🐥 chick when 6h–3d", () => {
  const { cls, text } = ageMarker(T(24 * 3_600_000)); // 1d
  assert.equal(cls, "age-stale");
  assert.ok(text.startsWith("🐥"));
});

test("ageMarker: 🐔 chicken when 3d–7d", () => {
  const { cls, text } = ageMarker(T(4 * 86_400_000)); // 4d
  assert.equal(cls, "age-stale");
  assert.ok(text.startsWith("🐔"));
});

test("ageMarker: 🍗 cooked when >= 7d", () => {
  const { cls, text } = ageMarker(T(8 * 86_400_000)); // 8d
  assert.equal(cls, "age-ancient");
  assert.ok(text.startsWith("🍗"));
});

// ── mergeChip ─────────────────────────────────────────────────────────────────

test("mergeChip: DIRTY → red conflict chip", () => {
  const chip = mergeChip({ mergeStateStatus: "DIRTY" });
  assert.equal(chip.cls, "red");
  assert.ok(chip.text.includes("Conflict"));
});

test("mergeChip: BEHIND → yellow behind chip", () => {
  const chip = mergeChip({ mergeStateStatus: "BEHIND" });
  assert.equal(chip.cls, "yellow");
  assert.ok(chip.text.includes("Behind"));
});

test("mergeChip: CLEAN → green fresh chip", () => {
  const chip = mergeChip({ mergeStateStatus: "CLEAN" });
  assert.equal(chip.cls, "green");
  assert.ok(chip.text.includes("Fresh"));
});

test("mergeChip: UNSTABLE/BLOCKED/HAS_HOOKS → green fresh chip", () => {
  for (const s of ["UNSTABLE", "BLOCKED", "HAS_HOOKS"]) {
    const chip = mergeChip({ mergeStateStatus: s });
    assert.equal(chip.cls, "green", `expected green for ${s}`);
  }
});

test("mergeChip: UNKNOWN → null (suppress during flicker)", () => {
  assert.equal(mergeChip({ mergeStateStatus: "UNKNOWN" }), null);
  assert.equal(mergeChip({ mergeStateStatus: undefined }), null);
});

// ── ciChip ────────────────────────────────────────────────────────────────────

test("ciChip: SUCCESS → green chip", () => {
  assert.equal(ciChip({ ciStatus: "SUCCESS" }).cls, "green");
});

test("ciChip: FAILURE → red chip", () => {
  assert.equal(ciChip({ ciStatus: "FAILURE" }).cls, "red");
});

test("ciChip: PENDING → yellow chip", () => {
  assert.equal(ciChip({ ciStatus: "PENDING" }).cls, "yellow");
});

test("ciChip: unknown status → null", () => {
  assert.equal(ciChip({ ciStatus: null }), null);
  assert.equal(ciChip({}), null);
});

// ── reviewChip ────────────────────────────────────────────────────────────────

const ME = "alice";

function makeReviewPr(overrides = {}) {
  return {
    author: { login: "alice" },
    role: "author",
    reviewDecision: "REVIEW_REQUIRED",
    reviewRequests: [],
    latestReviews: [],
    reviews: [],
    isDraft: false,
    ...overrides,
  };
}

test("reviewChip: author + APPROVED → ready to merge", () => {
  const pr = makeReviewPr({ reviewDecision: "APPROVED" });
  const chip = reviewChip(pr, ME);
  assert.equal(chip.cls, "green");
  assert.ok(chip.text.includes("merge"));
});

test("reviewChip: author + CHANGES_REQUESTED (unaddressed blocker) → fix requested", () => {
  const pr = makeReviewPr({
    reviewDecision: "CHANGES_REQUESTED",
    latestReviews: [{ login: "bob", state: "CHANGES_REQUESTED" }],
    reviewRequests: [],
  });
  const chip = reviewChip(pr, ME);
  assert.equal(chip.cls, "review-changes");
  assert.ok(chip.text.includes("Fix"));
});

test("reviewChip: author + CHANGES_REQUESTED (re-requested) → re-review pending", () => {
  const pr = makeReviewPr({
    reviewDecision: "CHANGES_REQUESTED",
    latestReviews: [{ login: "bob", state: "CHANGES_REQUESTED" }],
    reviewRequests: ["bob"], // re-requested → blocker addressed
  });
  const chip = reviewChip(pr, ME);
  assert.equal(chip.cls, "yellow");
  assert.ok(chip.text.includes("Re-review"));
});

test("reviewChip: author + no engagement → reviewers needed", () => {
  const pr = makeReviewPr({ reviewRequests: [], latestReviews: [] });
  const chip = reviewChip(pr, ME);
  assert.ok(chip.text.includes("Reviewers needed"));
});

test("reviewChip: author + in-review (has reviewers) → in review", () => {
  const pr = makeReviewPr({ reviewRequests: ["bob"] });
  const chip = reviewChip(pr, ME);
  assert.equal(chip.cls, "yellow");
  assert.ok(chip.text.includes("In review"));
});

test("reviewChip: reviewer + first-time request (no prior review) → review requested", () => {
  const pr = makeReviewPr({
    role: "reviewer",
    author: { login: "bob" },
    reviewRequests: [ME],
    reviews: [],
  });
  const chip = reviewChip(pr, ME);
  assert.ok(chip.text.includes("Review requested"));
  assert.ok(!chip.text.includes("Re-review"));
});

test("reviewChip: reviewer + re-requested (has prior review) → re-review requested", () => {
  const pr = makeReviewPr({
    role: "reviewer",
    author: { login: "bob" },
    reviewRequests: [ME],
    reviews: [{ author: { login: ME }, state: "COMMENTED", submittedAt: "2024-01-10T00:00:00Z" }],
  });
  const chip = reviewChip(pr, ME);
  assert.ok(chip.text.includes("Re-review requested"));
});

test("reviewChip: reviewer after CHANGES_REQUESTED → author to fix", () => {
  const pr = makeReviewPr({
    role: "reviewer",
    author: { login: "bob" },
    reviewRequests: [],
    latestReviews: [{ login: ME, state: "CHANGES_REQUESTED" }],
    reviews: [{ author: { login: ME }, state: "CHANGES_REQUESTED", submittedAt: "2024-01-10T00:00:00Z" }],
  });
  const chip = reviewChip(pr, ME);
  assert.equal(chip.cls, "review-changes");
  assert.ok(chip.text.includes("Author to fix"));
});

test("reviewChip: reviewer after APPROVED → author to merge", () => {
  const pr = makeReviewPr({
    role: "reviewer",
    author: { login: "bob" },
    reviewRequests: [],
    latestReviews: [{ login: ME, state: "APPROVED" }],
    reviews: [{ author: { login: ME }, state: "APPROVED", submittedAt: "2024-01-10T00:00:00Z" }],
  });
  const chip = reviewChip(pr, ME);
  assert.equal(chip.cls, "green");
  assert.ok(chip.text.includes("Author to merge"));
});

// ── priorityChip ──────────────────────────────────────────────────────────────

test("priorityChip: CI red preempts review chip", () => {
  const pr = makeReviewPr({ ciStatus: "FAILURE", reviewDecision: "APPROVED" });
  const chip = priorityChip(pr, ME);
  assert.equal(chip.cls, "red");
  assert.ok(chip.text.includes("CI"));
});

test("priorityChip: CI non-red → falls through to reviewChip", () => {
  const pr = makeReviewPr({ ciStatus: "SUCCESS", reviewDecision: "APPROVED" });
  const chip = priorityChip(pr, ME);
  assert.equal(chip.cls, "green");
  assert.ok(chip.text.includes("merge"));
});

test("priorityChip: no CI → falls through to reviewChip", () => {
  const pr = makeReviewPr({ ciStatus: null, reviewDecision: "REVIEW_REQUIRED", reviewRequests: ["bob"] });
  const chip = priorityChip(pr, ME);
  assert.equal(chip.cls, "yellow");
});
