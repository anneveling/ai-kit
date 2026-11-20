import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recording, replaying } from "../src/record.ts";

test("what was recorded replays; anything else is a clear error", async () => {
  const dir = join(mkdtempSync(join(tmpdir(), "bridge-rec-")), "github");
  const live = async (args: string[]) => ({ asked: args.join(" ") });
  const rec = recording(live, dir);
  assert.deepEqual(await rec(["pr", "view", "1"]), { asked: "pr view 1" });
  const replay = replaying<[string[]]>(dir);
  assert.deepEqual(await replay(["pr", "view", "1"]), { asked: "pr view 1" });
  await assert.rejects(replay(["pr", "view", "2"]), /nothing recorded/);
});

test("the window's start date doesn't change the key", async () => {
  const dir = join(mkdtempSync(join(tmpdir(), "bridge-rec-")), "linear");
  await recording(async (_q: string, _v: object) => "ok", dir)("query", { since: "2026-11-06T10:00:00.000Z" });
  assert.equal(await replaying<[string, object]>(dir)("query", { since: "2026-11-07T11:30:00.000Z" }), "ok");
});
