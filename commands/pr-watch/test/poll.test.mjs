import { test } from "node:test";
import assert from "node:assert/strict";
import { ciSummary, computeStopTime, diffPr } from "../lib.mjs";

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
