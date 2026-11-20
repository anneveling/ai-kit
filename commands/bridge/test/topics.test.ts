import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTopics } from "../src/topics.ts";
import { parseConfig } from "../src/config.ts";
import type { Decision } from "../src/types.ts";
import { event, item, T0 } from "./helpers.ts";

const config = parseConfig({ areas: ["Acme", "Personal"] }, "test", {});
const now = new Date("2026-11-20T12:00:00.000Z");
const at = (min: number) => new Date(Date.parse(T0) + min * 60_000).toISOString();
const build = (items: ReturnType<typeof item>[], decisions: Decision[] = [], events = []) =>
  buildTopics({ items, events, decisions, config, now });
const byId = (r: ReturnType<typeof build>, id: string) => r.topics.find((t) => t.id === id);

test("items with a story key land in story:<key>; others go to New", () => {
  const r = build([item("pr1", { storyKey: "BG-1" }), item("pr2", { storyKey: "BG-1" }), item("dm")]);
  assert.deepEqual(byId(r, "story:BG-1")?.itemIds, ["pr1", "pr2"]);
  assert.deepEqual(r.newItems, ["dm"]);
});

test("a story topic is named after its Linear story", () => {
  const r = build([
    item("github:acme/web#1", { storyKey: "BG-1" }),
    item("linear:BG-1", { source: "linear", kind: "story", title: "Payout retries", storyKey: "BG-1" }),
  ]);
  assert.equal(byId(r, "story:BG-1")?.name, "Payout retries");
});

test("roll-up: your move > in motion > waiting > quiet", () => {
  const r = build([
    item("a", { storyKey: "S", a: { state: "waiting", line: "waiting on Sam" } }),
    item("b", { storyKey: "S", a: { state: "your_move", ball: ["me"], line: "review #2", since: at(30) } }),
    item("c", { storyKey: "S", a: { state: "in_motion", ball: ["ci"] } }),
  ]);
  const t = byId(r, "story:S")!;
  assert.equal(t.state, "your_move");
  assert.equal(t.line, "review #2");
  assert.deepEqual(t.ball, ["me"]);
  assert.equal(t.yourMoveCount, 1);
});

test("roll-up: the longest waiting your-move item decides the line and since", () => {
  const r = build([
    item("a", { storyKey: "S", a: { state: "your_move", ball: ["me"], line: "newer", since: at(50) } }),
    item("b", { storyKey: "S", a: { state: "your_move", ball: ["me"], line: "older", since: at(10) } }),
  ]);
  const t = byId(r, "story:S")!;
  assert.equal(t.line, "older");
  assert.equal(t.since, at(10));
  assert.equal(t.yourMoveCount, 2);
});

test("merge: a story merged into a bigger topic keeps pulling in its new items", () => {
  const decisions: Decision[] = [
    { kind: "new_topic", id: "payouts", name: "Payouts v2", at: at(0) },
    { kind: "merge", from: "story:BG-1", into: "payouts", at: at(1) },
  ];
  const r = build([item("pr1", { storyKey: "BG-1" }), item("pr-later", { storyKey: "BG-1" })], decisions);
  assert.deepEqual(byId(r, "payouts")?.itemIds, ["pr1", "pr-later"]);
  assert.equal(byId(r, "story:BG-1"), undefined);
});

test("merge chains resolve: A into B, B into C", () => {
  const decisions: Decision[] = [
    { kind: "new_topic", id: "c", name: "C", at: at(0) },
    { kind: "merge", from: "story:A", into: "story:B", at: at(1) },
    { kind: "merge", from: "story:B", into: "c", at: at(2) },
  ];
  const r = build([item("a1", { storyKey: "A" }), item("b1", { storyKey: "B" })], decisions);
  assert.deepEqual(byId(r, "c")?.itemIds, ["a1", "b1"]);
});

test("move: an item goes to another topic, also from New", () => {
  const decisions: Decision[] = [{ kind: "move", item: "dm", to: "story:S", at: at(0) }];
  const r = build([item("pr", { storyKey: "S" }), item("dm")], decisions);
  assert.deepEqual(byId(r, "story:S")?.itemIds, ["pr", "dm"]);
  assert.deepEqual(r.newItems, []);
});

test("move into a merged topic follows the merge", () => {
  const decisions: Decision[] = [
    { kind: "new_topic", id: "big", name: "Big", at: at(0) },
    { kind: "merge", from: "story:S", into: "big", at: at(1) },
    { kind: "move", item: "dm", to: "story:S", at: at(2) },
  ];
  const r = build([item("dm")], decisions);
  assert.deepEqual(byId(r, "big")?.itemIds, ["dm"]);
});

test("split: an item gets its own new topic", () => {
  const decisions: Decision[] = [{ kind: "split", item: "pr2", id: "side", name: "Side thing", at: at(0) }];
  const r = build([item("pr1", { storyKey: "S" }), item("pr2", { storyKey: "S" })], decisions);
  assert.deepEqual(byId(r, "story:S")?.itemIds, ["pr1"]);
  assert.equal(byId(r, "side")?.name, "Side thing");
  assert.deepEqual(byId(r, "side")?.itemIds, ["pr2"]);
});

test("new_topic: an empty topic I made still shows, quiet", () => {
  const r = build([], [{ kind: "new_topic", id: "bike", name: "Bike repair", at: at(0) }]);
  assert.equal(byId(r, "bike")?.state, "quiet");
});

test("a story topic with no items left disappears", () => {
  const r = build([item("pr", { storyKey: "S" })], [{ kind: "move", item: "pr", to: "story:T", at: at(0) }]);
  assert.equal(byId(r, "story:S"), undefined);
  assert.deepEqual(byId(r, "story:T")?.itemIds, ["pr"]);
});

test("close: hidden, and reopen rule 'ball_to_me' brings it back when the ball comes to me after closing", () => {
  const close: Decision = { kind: "close", topic: "story:S", reopen: "ball_to_me", at: at(20) };
  const before = build([item("pr", { storyKey: "S", a: { state: "your_move", ball: ["me"], since: at(10) } })], [close]);
  assert.ok(byId(before, "story:S")?.closed);
  const after = build([item("pr", { storyKey: "S", a: { state: "your_move", ball: ["me"], since: at(30) } })], [close]);
  assert.equal(byId(after, "story:S")?.closed, undefined);
});

test("close with 'any_activity' reopens on any event after closing; 'never' does not", () => {
  const items = [item("pr", { storyKey: "S" })];
  const events = [event("pr", at(30))];
  const any = buildTopics({ items, events, config, now, decisions: [{ kind: "close", topic: "story:S", reopen: "any_activity", at: at(20) }] });
  assert.equal(any.topics[0]?.closed, undefined);
  const never = buildTopics({ items, events, config, now, decisions: [{ kind: "close", topic: "story:S", reopen: "never", at: at(20) }] });
  assert.ok(never.topics[0]?.closed);
});

test("reopen undoes a close", () => {
  const r = build([item("pr", { storyKey: "S" })], [
    { kind: "close", topic: "story:S", reopen: "never", at: at(1) },
    { kind: "reopen", topic: "story:S", at: at(2) },
  ]);
  assert.equal(byId(r, "story:S")?.closed, undefined);
});

test("snooze holds until its time, then lapses", () => {
  const r = build([item("pr", { storyKey: "S" })], [{ kind: "snooze", topic: "story:S", until: "2026-11-20T13:00:00.000Z", at: at(0) }]);
  assert.equal(byId(r, "story:S")?.snoozedUntil, "2026-11-20T13:00:00.000Z");
  const lapsed = build([item("pr", { storyKey: "S" })], [{ kind: "snooze", topic: "story:S", until: "2026-11-20T11:00:00.000Z", at: at(0) }]);
  assert.equal(byId(lapsed, "story:S")?.snoozedUntil, undefined);
});

test("seen keeps the latest time", () => {
  const r = build([item("pr", { storyKey: "S" })], [
    { kind: "seen", topic: "story:S", upTo: at(30), at: at(30) },
    { kind: "seen", topic: "story:S", upTo: at(10), at: at(31) },
  ]);
  assert.equal(byId(r, "story:S")?.seenUpTo, at(30));
});

test("name, colour and area overrides; area otherwise from the items", () => {
  const r = build([item("pr", { storyKey: "S", area: "Personal" })], []);
  assert.equal(byId(r, "story:S")?.area, "Personal");
  assert.match(byId(r, "story:S")!.colour, /^#/);
  const o = build([item("pr", { storyKey: "S", area: "Personal" })], [
    { kind: "name", topic: "story:S", name: "Renamed", at: at(0) },
    { kind: "colour", topic: "story:S", colour: "#123456", at: at(0) },
    { kind: "area", topic: "story:S", area: "Acme", at: at(0) },
  ]);
  const t = byId(o, "story:S")!;
  assert.deepEqual([t.name, t.colour, t.area], ["Renamed", "#123456", "Acme"]);
});

test("an override on a topic that was merged away does nothing", () => {
  const r = build([item("pr", { storyKey: "S" })], [
    { kind: "new_topic", id: "big", name: "Big", at: at(0) },
    { kind: "merge", from: "story:S", into: "big", at: at(1) },
    { kind: "name", topic: "story:S", name: "ignored after merge", at: at(2) },
  ]);
  assert.equal(byId(r, "big")?.name, "Big");
});

test("dismiss_action drops the next action until the ball moves again", () => {
  const items = [item("pr", { storyKey: "S", a: { state: "your_move", ball: ["me"], since: at(10), next: { verb: "review", label: "Review #1" } } })];
  const r = build(items, [{ kind: "dismiss_action", item: "pr", at: at(20) }]);
  const pr = r.items.find((i) => i.id === "pr")!;
  assert.equal(pr.assessment.next, undefined);
  assert.equal(pr.assessment.state, "quiet");
  const moved = build([item("pr", { storyKey: "S", a: { state: "your_move", ball: ["me"], since: at(30), next: { verb: "review", label: "Review #1" } } })],
    [{ kind: "dismiss_action", item: "pr", at: at(20) }]);
  assert.equal(moved.items[0]?.assessment.next?.verb, "review");
});

test("without its Linear story, a story topic is named after its PR", () => {
  const r = build([item("github:acme/web#235", { storyKey: "AC-2346", kind: "pr", title: "#235 docs(AC-2346): retries stop after three" })]);
  assert.equal(byId(r, "story:AC-2346")?.name, "AC-2346 retries stop after three");
});
