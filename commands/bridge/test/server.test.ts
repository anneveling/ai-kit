import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { App } from "../src/app.ts";
import { fixedClock } from "../src/clock.ts";
import { parseConfig } from "../src/config.ts";
import { startServer } from "../src/server.ts";
import { Store } from "../src/store.ts";
import { item } from "./helpers.ts";

async function start() {
  const store = new Store();
  store.put("github", { items: [item("github:acme/web#1", { storyKey: "AC-1" }), item("slack:D1/1")], events: [] });
  const decisionsPath = join(mkdtempSync(join(tmpdir(), "bridge-srv-")), "decisions.jsonl");
  const app = new App({ store, config: parseConfig({}, "t", {}), clock: fixedClock("2026-11-20T10:00:00Z"), decisionsPath, health: () => [] });
  const server = await startServer(app, 0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { app, server, base, decisionsPath };
}

test("serves the bridge page, a topic page, the views and static files", async (t) => {
  const { server, base } = await start();
  t.after(() => server.close());
  assert.match(await (await fetch(`${base}/`)).text(), /<title>Bridge<\/title>/);
  assert.match(await (await fetch(`${base}/t/story:AC-1`)).text(), /topic\.js/);
  const bridge = await (await fetch(`${base}/api/bridge`)).json() as { groups: unknown[]; newItems: { id: string }[] };
  assert.deepEqual(bridge.newItems.map((i) => i.id), ["slack:D1/1"]);
  const topic = await (await fetch(`${base}/api/topic/${encodeURIComponent("story:AC-1")}`)).json() as { topic: { id: string } };
  assert.equal(topic.topic.id, "story:AC-1");
  assert.equal((await fetch(`${base}/api/topic/nope`)).status, 404);
  assert.equal((await fetch(`${base}/static/styles.css`)).headers.get("content-type"), "text/css; charset=utf-8");
  assert.equal((await fetch(`${base}/static/..%2Fpackage.json`)).status, 404);
});

test("SSE sends the version at once and again after a decision", async (t) => {
  const { server, base } = await start();
  const ctrl = new AbortController();
  t.after(() => { ctrl.abort(); server.close(); });
  const res = await fetch(`${base}/events`, { signal: ctrl.signal });
  assert.equal(res.headers.get("content-type"), "text/event-stream");
  const reader = res.body!.getReader();
  const read = async () => new TextDecoder().decode((await reader.read()).value);
  assert.match(await read(), /data: \{"version":0\}/);

  const post = await fetch(`${base}/decide`, { method: "POST", body: JSON.stringify({ kind: "move", item: "slack:D1/1", to: "story:AC-1" }) });
  assert.equal(post.status, 200);
  assert.match(await read(), /data: \{"version":1\}/);
  const bridge = await (await fetch(`${base}/api/bridge`)).json() as { newItems: unknown[] };
  assert.deepEqual(bridge.newItems, []);
});

test("a bad decision is a 400 with the reason", async (t) => {
  const { server, base } = await start();
  t.after(() => server.close());
  const res = await fetch(`${base}/decide`, { method: "POST", body: JSON.stringify({ kind: "move", item: "x" }) });
  assert.equal(res.status, 400);
  assert.match(await res.text(), /"to" is missing/);
});
