import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { GitHubSource } from "../src/sources/github.ts";
import { parseConfig } from "../src/config.ts";
import { Store } from "../src/store.ts";

const FIX = JSON.parse(readFileSync(new URL("./fixtures/github.json", import.meta.url), "utf8")) as Record<string, unknown>;
const now = new Date("2026-11-20T12:00:00Z");
const config = parseConfig({ areas: ["Acme"], areaMap: { repo: { "acme/payments": "Acme" } } }, "t", {});

/** A fake gh: answers from the fixture and records what was asked. */
function fakeGh(overrides: Record<string, unknown> = {}) {
  const calls: string[] = [];
  const answers = { ...FIX, ...overrides };
  const call = async (args: string[]) => {
    const line = args.join(" ");
    calls.push(line);
    if (line === "api user") return answers.user;
    if (args[0] === "search") {
      const key = Object.keys(answers).find((k) => k.startsWith("search:") && k.slice(7).split(" ").every((w) => line.includes(w)));
      if (!key) throw new Error(`no fixture for ${line}`);
      return answers[key];
    }
    if (args[0] === "pr" && args[1] === "view") {
      const pr = answers[`view:${args[2]}`];
      if (!pr) throw new Error(`no fixture for ${line}`);
      return pr;
    }
    throw new Error(`unexpected gh ${line}`);
  };
  return { call, calls };
}

test("items, story keys, areas and assessments from the searches", async () => {
  const gh = fakeGh();
  const r = await new GitHubSource(gh.call).poll({ config, now, store: new Store() });
  const ids = r.items.map((i) => i.id).sort();
  assert.deepEqual(ids, ["github:acme/payments#801", "github:acme/payments#812", "github:acme/web#830"]);
  const pr812 = r.items.find((i) => i.id.endsWith("#812"))!;
  assert.equal(pr812.storyKey, "AC-1636");
  assert.equal(pr812.area, "Acme");
  assert.equal(pr812.assessment.next?.verb, "fix");
  assert.equal(pr812.assessment.stuck, "ci_red_approved");
  const pr830 = r.items.find((i) => i.id.endsWith("#830"))!;
  assert.equal(pr830.storyKey, "AC-1702");
  assert.equal(pr830.assessment.line, "Maya asked your review on #830");
  assert.equal(r.items.find((i) => i.id.endsWith("#801"))?.status.label, "merged");
});

test("events: reviews, pushes, CI, merges; my own are mine", async () => {
  const r = await new GitHubSource(fakeGh().call).poll({ config, now, store: new Store() });
  const texts = r.events.filter((e) => e.itemId.endsWith("#812")).map((e) => `${e.who}: ${e.text}`);
  assert.deepEqual(texts.sort(), [
    "ci: #812 failed: test",
    "me: opened #812",
    "me: pushed 2 commits to #812",
    "toby: approved #812",
  ]);
  assert.ok(r.events.some((e) => e.text === "merged #801" && e.routine));
  assert.ok(r.people.some((p) => p.id === "maya" && p.name === "Maya"));
});

test("a second poll with unchanged updatedAt only refreshes the fast-moving fields", async () => {
  const gh = fakeGh();
  const source = new GitHubSource(gh.call);
  await source.poll({ config, now, store: new Store() });
  gh.calls.length = 0;
  await source.poll({ config, now, store: new Store() });
  const views = gh.calls.filter((c) => c.startsWith("pr view"));
  assert.ok(views.every((c) => !c.includes("commits")), "no full views");
  assert.ok(!views.some((c) => c.includes("/801")), "merged PRs aren't refreshed");
});

test("a failing search fails the poll, so the header says so", async () => {
  const gh = fakeGh();
  const failing = async (args: string[]) => { if (args[0] === "search") throw new Error("gh search prs: HTTP 502"); return gh.call(args); };
  await assert.rejects(new GitHubSource(failing).poll({ config, now, store: new Store() }), /502/);
});

test("a PR that can't be viewed keeps its last known state", async () => {
  const gh = fakeGh();
  const source = new GitHubSource(gh.call);
  await source.poll({ config, now, store: new Store() });
  const broken = fakeGh({ "search:--author @me open": [{ number: 812, title: "x", url: "https://github.com/acme/payments/pull/812", repository: { nameWithOwner: "acme/payments" }, updatedAt: "2026-11-20T11:30:00Z" }], "view:https://github.com/acme/payments/pull/812": undefined });
  const r = await new GitHubSource(broken.call).poll({ config, now, store: new Store() });
  assert.ok(!r.items.some((i) => i.id.endsWith("#812")), "a fresh source has nothing to keep");
  const again = await source.poll({ config, now, store: new Store() });
  assert.ok(again.items.some((i) => i.id.endsWith("#812")));
});
