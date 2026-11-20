// Regenerate docs/bridge.png and docs/topic.png from the made-up demo data.
// Serves the real pages on the demo's fixed clock, with no decisions of mine,
// and captures them with headless Chrome at 1440×900 @2x.
//
//   node scripts/screenshot.ts
//   CHROME=/path/to/chrome node scripts/screenshot.ts

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { demoApp } from "../src/demo.ts";
import { startServer } from "../src/server.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SHOTS: [string, string][] = [["/?still", "bridge.png"], ["/t/payouts?still", "topic.png"]];

const chrome = [
  process.env.CHROME,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome", "/usr/bin/chromium",
].find((p) => p && existsSync(p));
if (!chrome) { console.error("No Chrome found; set CHROME=/path/to/chrome"); process.exit(1); }

const scratch = mkdtempSync(join(tmpdir(), "bridge-shot-"));
const server = await startServer(demoApp(join(scratch, "decisions.jsonl")), 0);
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

function shoot(path: string, out: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // Async on purpose: a sync spawn would block the server Chrome loads from.
    const child = spawn(chrome!, [
      "--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run",
      `--user-data-dir=${join(scratch, "profile")}`,
      "--window-size=1440,900", "--force-device-scale-factor=2", "--virtual-time-budget=3000",
      `--screenshot=${out}`, base + path,
    ], { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    const timer = setTimeout(() => child.kill(), 30_000);
    child.stderr.on("data", (d) => { err += d; });
    child.on("close", (code) => {
      clearTimeout(timer);
      code === 0 && existsSync(out) ? resolve() : reject(new Error(`Chrome failed on ${path} (exit ${code}):\n${err.slice(-600)}`));
    });
  });
}

try {
  for (const [path, file] of SHOTS) {
    const out = join(ROOT, "docs", file);
    await shoot(path, out);
    console.log(`Wrote ${out}`);
  }
} finally {
  server.close();
  server.closeAllConnections();
  rmSync(scratch, { recursive: true, force: true });
}
