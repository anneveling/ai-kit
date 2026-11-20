import { test } from "node:test";
import assert from "node:assert/strict";
import { Poller } from "../src/poll.ts";
import { Store } from "../src/store.ts";
import { parseConfig } from "../src/config.ts";
import { fixedClock } from "../src/clock.ts";
import type { Source } from "../src/sources/source.ts";
import { item } from "./helpers.ts";

const config = parseConfig({ intervals: { github: 60 } }, "t", {});
const clock = fixedClock("2026-11-20T10:00:00Z");

function source(results: (Error | string[])[]): Source & { calls: number } {
  const s = {
    name: "github" as const, calls: 0,
    async poll() {
      const r = results[Math.min(s.calls++, results.length - 1)]!;
      if (r instanceof Error) throw r;
      return { items: r.map((id) => item(id)), events: [], people: [{ id: "toby", name: "Toby" }] };
    },
  };
  return s;
}

test("a good poll fills the store, marks the source healthy and reports a change", async () => {
  const store = new Store();
  let changes = 0;
  const p = new Poller([source([["a", "b"]])], { config, store, clock }, () => changes++);
  await p.pollOnce("github");
  assert.deepEqual(store.items().map((i) => i.id), ["a", "b"]);
  assert.deepEqual(p.health(), [{ source: "github", ok: true, lastOk: "2026-11-20T10:00:00.000Z" }]);
  assert.equal(changes, 1);
  assert.ok(store.people.some((x) => x.id === "toby"));
});

test("the same result twice doesn't report a change again", async () => {
  let changes = 0;
  const p = new Poller([source([["a"], ["a"]])], { config, store: new Store(), clock }, () => changes++);
  await p.pollOnce("github");
  await p.pollOnce("github");
  assert.equal(changes, 1);
});

test("a failing source keeps its items, says why, and backs off", async () => {
  const store = new Store();
  const p = new Poller([source([["a"], new Error("gh: HTTP 502"), new Error("gh: HTTP 502"), ["a", "c"]])], { config, store, clock }, () => {});
  await p.pollOnce("github");
  assert.equal(p.nextDelay("github"), 60_000);
  await p.pollOnce("github");
  assert.deepEqual(store.items().map((i) => i.id), ["a"]);
  assert.deepEqual(p.health()[0], { source: "github", ok: false, lastOk: "2026-11-20T10:00:00.000Z", message: "gh: HTTP 502" });
  assert.equal(p.nextDelay("github"), 120_000);
  await p.pollOnce("github");
  assert.equal(p.nextDelay("github"), 240_000);
  await p.pollOnce("github");
  assert.equal(p.health()[0]?.ok, true);
  assert.equal(p.nextDelay("github"), 60_000);
});

test("backoff stops at 15 minutes", async () => {
  const p = new Poller([source([new Error("down")])], { config, store: new Store(), clock }, () => {});
  for (let i = 0; i < 10; i++) await p.pollOnce("github");
  assert.equal(p.nextDelay("github"), 15 * 60_000);
});

test("a source that hasn't polled yet says so", () => {
  const p = new Poller([source([["a"]])], { config, store: new Store(), clock }, () => {});
  assert.deepEqual(p.health(), [{ source: "github", ok: false, message: "starting…" }]);
});
