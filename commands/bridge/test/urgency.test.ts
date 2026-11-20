import { test } from "node:test";
import assert from "node:assert/strict";
import { withAlerts, pickHot } from "../src/urgency.ts";
import { buildTopics } from "../src/topics.ts";
import { parseConfig } from "../src/config.ts";
import type { Decision, Item } from "../src/types.ts";
import { item } from "./helpers.ts";

const config = parseConfig({ areas: ["Acme", "Personal"] }, "test", {});
// Local times, 2026-11-20 is a Friday.
const local = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m);
const iso = (d: number, h: number, m = 0) => local(d, h, m).toISOString();

function run(items: Item[], now: Date, decisions: Decision[] = []) {
  const r = buildTopics({ items, events: [], decisions, config, now });
  return withAlerts(r.topics, r.items, config, now);
}
const mine = (id: string, story: string, since: string, over: Partial<Item["assessment"]> = {}, area?: string) =>
  item(id, { storyKey: story, area, a: { state: "your_move", ball: ["me"], since, line: id, ...over } });

test("a question to me is yellow before 2 working hours, red after", () => {
  const it = [mine("q", "S", iso(20, 10), { stuck: "question" })];
  assert.equal(run(it, local(20, 11, 59))[0]?.alert, "yellow");
  assert.equal(run(it, local(20, 12, 0))[0]?.alert, "red");
});

test("outside working hours the 2h clock doesn't run", () => {
  const it = [mine("q", "S", iso(20, 17, 30), { stuck: "question" })];
  // Friday 17:30 → Monday 09:59 is 1h29 of working time
  assert.equal(run(it, local(23, 9, 59))[0]?.alert, "yellow");
  assert.equal(run(it, local(23, 10, 30))[0]?.alert, "red");
});

test("CI red on an approved PR and an overdue GTD task are red at once", () => {
  assert.equal(run([mine("pr", "S", iso(20, 10), { stuck: "ci_red_approved" })], local(20, 10, 1))[0]?.alert, "red");
  assert.equal(run([mine("t", "S", iso(20, 10), { stuck: "overdue" })], local(20, 10, 1))[0]?.alert, "red");
});

test("an officer question is red only on a topic that's already red", () => {
  const officer = mine("job", "S", iso(20, 10), { stuck: "officer_question" });
  assert.equal(run([officer], local(20, 15))[0]?.alert, "yellow");
  const ci = mine("pr", "S", iso(20, 10), { stuck: "ci_red_approved" });
  assert.equal(run([officer, ci], local(20, 15))[0]?.alert, "red");
});

test("any other my move is yellow; not my move is no alert", () => {
  assert.equal(run([mine("r", "S", iso(20, 10))], local(20, 15))[0]?.alert, "yellow");
  const waiting = item("w", { storyKey: "S", a: { state: "waiting", ball: ["sam"], next: { verb: "nudge", label: "Nudge Sam" } } });
  assert.equal(run([waiting], local(20, 15))[0]?.alert, undefined);
});

test("snoozed and closed topics get no alert", () => {
  const it = [mine("pr", "S", iso(20, 10), { stuck: "ci_red_approved" })];
  const snoozed = run(it, local(20, 11), [{ kind: "snooze", topic: "story:S", until: iso(21, 9), at: iso(20, 10, 30) }]);
  assert.equal(snoozed[0]?.alert, undefined);
});

test("hot: at most three, red first, then the longest waiting", () => {
  const now = local(20, 16);
  const topics = run([
    mine("y-old", "A", iso(20, 9, 5)),
    mine("y-new", "B", iso(20, 15)),
    mine("red", "C", iso(20, 14), { stuck: "ci_red_approved" }),
    mine("y-mid", "D", iso(20, 12)),
  ], now);
  const { hot } = pickHot(topics);
  assert.deepEqual(hot.map((t) => t.id), ["story:C", "story:A", "story:D"]);
});

test("a nudge is never hot", () => {
  const waiting = item("w", { storyKey: "S", a: { state: "waiting", ball: ["sam"], since: iso(18, 9), next: { verb: "nudge", label: "Nudge Sam" } } });
  assert.deepEqual(pickHot(run([waiting], local(20, 15))).hot, []);
});

test("the hot block splits by area only when hot topics span areas", () => {
  const now = local(20, 16);
  const one = pickHot(run([mine("a", "A", iso(20, 10), {}, "Acme"), mine("b", "B", iso(20, 11), {}, "Acme")], now));
  assert.equal(one.split, false);
  const two = pickHot(run([mine("a", "A", iso(20, 10), {}, "Acme"), mine("b", "B", iso(20, 11), {}, "Personal")], now));
  assert.equal(two.split, true);
});
