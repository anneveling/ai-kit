#!/usr/bin/env node
/**
 * Smoke-test ballInCourt on the global install (~/.claude/pr-watch/lib.mjs).
 * Run after: ./scripts/sync-global.sh
 */
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { homedir } from "node:os";

const home = process.env.PR_WATCH_HOME || join(homedir(), ".claude", "pr-watch");
const libUrl = pathToFileURL(join(home, "lib.mjs")).href;
const { ballInCourt } = await import(libUrl);

function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
}

function makePr(overrides = {}) {
  return {
    author: { login: "alice" },
    isDraft: false,
    reviewRequests: [],
    latestReviews: [],
    reviewDecision: "REVIEW_REQUIRED",
    mergeStateStatus: "CLEAN",
    ciStatus: "SUCCESS",
    role: "author",
    reviews: [],
    ...overrides,
  };
}

const cases = [
  {
    name: "CI PENDING → reviewer only (not author)",
    pr: makePr({ ciStatus: "PENDING", reviewRequests: ["bob"] }),
    me: "alice",
    want: ["bob"],
  },
  {
    name: "Reviewer submitted COMMENTED → author only (not reviewer)",
    pr: makePr({
      role: "reviewer",
      author: { login: "bob" },
      reviewRequests: [],
      latestReviews: [{ login: "wilfred", state: "COMMENTED" }],
      reviews: [{ author: { login: "wilfred" }, state: "COMMENTED", submittedAt: "2026-01-01T00:00:00Z" }],
    }),
    me: "wilfred",
    want: ["bob"],
  },
  {
    name: "A commented, B still requested → author + B",
    pr: makePr({
      reviewRequests: ["carol"],
      latestReviews: [{ login: "bob", state: "COMMENTED" }],
    }),
    me: "alice",
    want: ["alice", "carol"],
  },
  {
    name: "All APPROVED, no pending → author",
    pr: makePr({
      reviewDecision: "REVIEW_REQUIRED",
      latestReviews: [{ login: "bob", state: "APPROVED" }],
    }),
    me: "alice",
    want: ["alice"],
  },
];

let passed = 0;
for (const { name, pr, me, want } of cases) {
  const got = [...ballInCourt(pr, me)].sort();
  const expected = [...want].sort();
  assert(
    got.length === expected.length && got.every((l, i) => l === expected[i]),
    `${name}\n  got: ${got.join(", ") || "(empty)"}\n  want: ${expected.join(", ")}`,
  );
  console.log("ok:", name);
  passed++;
}

console.log(`\n${passed} smoke scenarios passed (${home}/lib.mjs)`);
