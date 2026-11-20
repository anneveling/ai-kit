import { test } from "node:test";
import assert from "node:assert/strict";
import { workingMsBetween } from "../src/clock.ts";

const H = { start: 9, end: 18, days: [1, 2, 3, 4, 5] };
const MIN = 60_000;
// Local time, so the tests hold in any time zone. 2026-11-20 is a Friday.
const at = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m);

test("within one working day", () => {
  assert.equal(workingMsBetween(at(20, 10), at(20, 12, 30), H), 150 * MIN);
});

test("Friday 17:30 is 30 min old at Monday 09:00", () => {
  assert.equal(workingMsBetween(at(20, 17, 30), at(23, 9), H), 30 * MIN);
});

test("overnight counts only working hours", () => {
  // Thu 17:00 → Fri 10:00: 1h Thursday + 1h Friday
  assert.equal(workingMsBetween(at(19, 17), at(20, 10), H), 120 * MIN);
});

test("a question asked at the weekend starts counting on Monday at 09:00", () => {
  assert.equal(workingMsBetween(at(21, 14), at(23, 11), H), 120 * MIN);
});

test("before working hours nothing counts", () => {
  assert.equal(workingMsBetween(at(20, 6), at(20, 8, 59), H), 0);
});

test("end before start is 0", () => {
  assert.equal(workingMsBetween(at(20, 12), at(20, 10), H), 0);
});

test("a whole week is five working days", () => {
  assert.equal(workingMsBetween(at(16, 0), at(23, 0), H), 5 * 9 * 60 * MIN);
});
