import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LinearSource, linearGql } from "../src/sources/linear.ts";
import { parseConfig } from "../src/config.ts";
import { Store } from "../src/store.ts";
import { item } from "./helpers.ts";

const FIX = JSON.parse(readFileSync(new URL("./fixtures/linear.json", import.meta.url), "utf8"));
const now = new Date("2026-11-20T12:00:00Z");
const config = parseConfig({ areas: ["Acme"], areaMap: { team: { AC: "Acme" } } }, "t", {});

function fakeGql() {
  const queries: string[] = [];
  const gql = async (query: string) => {
    queries.push(query);
    if (query.includes("query Mine")) return { viewer: FIX.viewer, issues: { nodes: FIX.mine }, notifications: { nodes: FIX.notifications } };
    if (query.includes("query ByKey")) {
      const out: Record<string, unknown> = {};
      for (const m of query.matchAll(/(k\d+): issue\(id: "([^"]+)"\)/g)) out[m[1]!] = FIX.byKey[m[2]!] ?? null;
      return out;
    }
    throw new Error("unexpected query");
  };
  return { gql, queries };
}

function storeWithPrKeys(...keys: string[]) {
  const store = new Store();
  store.put("github", { items: keys.map((k, i) => item(`github:acme/web#${i}`, { storyKey: k })), events: [] });
  return store;
}

test("my stories plus the ones PRs point at; unknown keys are skipped", async () => {
  const { gql } = fakeGql();
  const r = await new LinearSource(gql).poll({ config, now, store: storeWithPrKeys("AC-1702", "AC-1636", "UTF-8") });
  assert.deepEqual(r.items.map((i) => i.id).sort(), ["linear:AC-1636", "linear:AC-1702", "linear:AC-1750"]);
  const s = r.items.find((i) => i.id === "linear:AC-1636")!;
  assert.equal(s.area, "Acme");
  assert.equal(s.context, "Payouts v2 · Go-live 12 Dec · 62%");
  assert.equal(s.assessment.state, "your_move");
  assert.equal(s.assessment.line, "Sam mentioned you on AC-1636");
  assert.ok(r.events.some((e) => e.who === "me" && e.text === "AC-1636 → In Review"));
  assert.ok(r.people.some((p) => p.name === "Sam"));
});

test("a mention on a story that isn't mine and has no PR still reaches me; old and status-only notifications don't", async () => {
  const { gql, queries } = fakeGql();
  const r = await new LinearSource(gql).poll({ config, now, store: new Store() });
  const s = r.items.find((i) => i.id === "linear:AC-1750")!;
  assert.equal(s.assessment.state, "your_move");
  assert.equal(s.assessment.line, "Toby mentioned you on AC-1750");
  const asked = queries.filter((q) => q.includes("ByKey")).join(" ");
  assert.ok(!asked.includes("AC-1999") && !asked.includes("AC-1001"));
});

test("stories already mine aren't asked for again", async () => {
  const { gql, queries } = fakeGql();
  await new LinearSource(gql).poll({ config, now, store: storeWithPrKeys("AC-1636") });
  assert.ok(!queries.filter((q) => q.includes("ByKey")).join(" ").includes("AC-1636"));
});

test("a bad key makes the batch fail; the rest still come through one by one", async () => {
  const { gql } = fakeGql();
  const strict = async (query: string) => {
    if (query.includes('"UTF-8"')) throw new Error("Linear: Entity not found");
    return gql(query);
  };
  const r = await new LinearSource(strict).poll({ config, now, store: storeWithPrKeys("AC-1702", "UTF-8") });
  assert.ok(r.items.some((i) => i.id === "linear:AC-1702"));
});

test("a bad key or rate limit is a clear error", async () => {
  const server = (status: number, body: unknown) => async () => new Response(JSON.stringify(body), { status });
  const real = globalThis.fetch;
  try {
    globalThis.fetch = server(401, {}) as typeof fetch;
    await assert.rejects(linearGql("x")("query { viewer { id } }"), /API key is not valid/);
    globalThis.fetch = server(200, { errors: [{ message: "Field 'nope' doesn't exist" }] }) as typeof fetch;
    await assert.rejects(linearGql("x")("query { nope }"), /Field 'nope'/);
  } finally {
    globalThis.fetch = real;
  }
});
