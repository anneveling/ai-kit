import { test } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendDecision, readDecisions, validateDecision } from "../src/decisions.ts";

const file = () => join(mkdtempSync(join(tmpdir(), "bridge-dec-")), "decisions.jsonl");

test("missing file is no decisions, no errors", () => {
  assert.deepEqual(readDecisions(file()), { decisions: [], errors: [] });
});

test("round trip keeps order", () => {
  const f = file();
  appendDecision(f, { kind: "merge", from: "story:BG-1", into: "payouts", at: "2026-11-20T10:00:00.000Z" });
  appendDecision(f, { kind: "seen", topic: "payouts", upTo: "2026-11-20T10:05:00.000Z", at: "2026-11-20T10:05:00.000Z" });
  const { decisions, errors } = readDecisions(f);
  assert.equal(errors.length, 0);
  assert.deepEqual(decisions.map((d) => d.kind), ["merge", "seen"]);
});

test("a corrupt line in the middle is skipped and reported, and the file is not rewritten", () => {
  const f = file();
  appendDecision(f, { kind: "new_topic", id: "a", name: "A", at: "2026-11-20T10:00:00.000Z" });
  appendFileSync(f, "{ broken\n");
  appendFileSync(f, JSON.stringify({ kind: "nonsense", at: "x" }) + "\n");
  appendDecision(f, { kind: "new_topic", id: "b", name: "B", at: "2026-11-20T10:01:00.000Z" });
  const before = readFileSync(f, "utf8");
  const { decisions, errors } = readDecisions(f);
  assert.deepEqual(decisions.map((d) => (d as { id: string }).id), ["a", "b"]);
  assert.deepEqual(errors.map((e) => e.line), [2, 3]);
  assert.equal(readFileSync(f, "utf8"), before);
});

test("validate rejects missing fields", () => {
  assert.match(validateDecision({ kind: "move", item: "x", at: "2026-11-20T10:00:00Z" }) ?? "", /to/);
  assert.match(validateDecision({ kind: "close", topic: "t", reopen: "sometimes", at: "2026-11-20T10:00:00Z" }) ?? "", /reopen/);
  assert.equal(validateDecision({ kind: "snooze", topic: "t", until: "2026-11-21T09:00:00Z", at: "2026-11-20T10:00:00Z" }), undefined);
});
