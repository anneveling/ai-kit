import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, parseConfig, areaFor } from "../src/config.ts";

const tmp = () => mkdtempSync(join(tmpdir(), "bridge-config-"));

test("missing file gives the defaults", () => {
  const c = loadConfig(join(tmp(), "nope.json"), {});
  assert.equal(c.me.id, "me");
  assert.deepEqual(c.workingHours, { start: 9, end: 18, days: [1, 2, 3, 4, 5] });
  assert.ok(c.areas.length > 0);
  assert.ok(c.colours.length >= 8);
  assert.ok(c.intervals.github > 0);
});

test("tokens come from env, never from the file", () => {
  const dir = tmp();
  const p = join(dir, "config.json");
  writeFileSync(p, JSON.stringify({ tokens: { slack: "from-file" } }));
  const c = loadConfig(p, { BRIDGE_SLACK_TOKEN: "from-env", BRIDGE_LINEAR_TOKEN: "lin" });
  assert.equal(c.tokens.slack, "from-env");
  assert.equal(c.tokens.linear, "lin");
  assert.equal(c.tokens.notion, undefined);
});

test("file values override the defaults, the rest stays default", () => {
  const c = parseConfig({ areas: ["Acme", "Personal"], workingHours: { start: 8 } }, "x.json", {});
  assert.deepEqual(c.areas, ["Acme", "Personal"]);
  assert.equal(c.workingHours.start, 8);
  assert.equal(c.workingHours.end, 18);
});

test("an area mapping to an unknown area is a clear error", () => {
  assert.throws(
    () => parseConfig({ areas: ["Acme"], areaMap: { repo: { "acme/web": "Acme Corp" } } }, "x.json", {}),
    /x\.json: repo "acme\/web" maps to area "Acme Corp", which is not in areas \(Acme\)/,
  );
});

test("bad JSON names the file", () => {
  const p = join(tmp(), "config.json");
  writeFileSync(p, "{ nope");
  assert.throws(() => loadConfig(p, {}), /config\.json: not valid JSON/);
});

test("bad working hours are an error", () => {
  assert.throws(() => parseConfig({ workingHours: { start: 18, end: 9 } }, "x.json", {}), /workingHours/);
});

test("areaFor looks up repo, channel, team and gtd area", () => {
  const c = parseConfig({ areas: ["Acme", "Personal"], areaMap: { repo: { "acme/web": "Acme" }, gtd: { Home: "Personal" } } }, "x.json", {});
  assert.equal(areaFor(c, "repo", "acme/web"), "Acme");
  assert.equal(areaFor(c, "gtd", "Home"), "Personal");
  assert.equal(areaFor(c, "channel", "C1"), undefined);
});
