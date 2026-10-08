#!/usr/bin/env node
// Regenerate docs/dashboard.png from the fake PRs in docs/demo.json.
// Serves the real dashboard files with that data (no GitHub, no gh) and
// captures it with headless Chrome at 1440×900 @2x.
//
// Usage:
//   node scripts/screenshot.mjs           write docs/dashboard.png
//   node scripts/screenshot.mjs --serve   just serve it; open the printed URL yourself
//   CHROME=/path/to/chrome node scripts/screenshot.mjs
//
// Dev-only: not copied by sync-global.sh.

import { spawn } from "child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "fs";
import { createServer } from "http";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { buildPayload, ciSummary } from "../lib.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "docs", "dashboard.png");
const demo = JSON.parse(readFileSync(join(ROOT, "docs", "demo.json"), "utf8"));
const { version } = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));

const NOW = Date.now();
const ago = (hours) => new Date(NOW - hours * 3600_000).toISOString();

// Expand a compact demo entry into the shape the poller writes to current.json.
function expand(p) {
  const role = p.author === demo.viewer ? "author" : "reviewer";
  const reviews = (p.reviews || []).map((r) => ({
    author: { login: r.by }, state: r.state, submittedAt: ago(r.ago), body: r.body || "",
  }));
  // Same reduction as poll.mjs latestReviewsFromDetails: latest per reviewer, not you.
  const latest = {};
  for (const r of reviews) {
    if (r.author.login === demo.viewer) continue;
    if (!latest[r.author.login] || r.submittedAt > latest[r.author.login].submittedAt) latest[r.author.login] = r;
  }
  return {
    number: p.number,
    title: p.title,
    url: `https://github.com/${p.repo}/pull/${p.number}`,
    repo: p.repo,
    role,
    author: { login: p.author },
    isDraft: false,
    state: "OPEN",
    reviewDecision: p.reviewDecision || "",
    ciStatus: p.ci ?? ciSummary([]),
    mergeable: p.merge === "DIRTY" ? "CONFLICTING" : "MERGEABLE",
    mergeStateStatus: p.merge || "CLEAN",
    reviews,
    reviewRequests: p.reviewRequests || [],
    latestReviews: Object.values(latest).map((r) => ({
      login: r.author.login, state: r.state, submittedAt: r.submittedAt, hasBody: Boolean(r.body),
    })),
    createdAt: ago((p.updated ?? 1) + 24),
    updatedAt: ago(p.updated ?? 1),
    _searchUpdatedAt: ago(p.updated ?? 1),
  };
}

const payload = {
  ...buildPayload(demo.prs.map(expand), demo.viewer, { schemaVersion: 1, pollerVersion: version }),
  repoPaths: Object.fromEntries(Object.entries(demo.repoPaths).map(([repo, path]) => [repo, { path, source: path ? "claude" : null }])),
  config: { claudeTarget: "desktop" },
  claudeTargets: { desktop: true, cli: true, guess: "desktop" },
  reposScript: "~/.claude/pr-watch/repos.mjs",
};

const FILES = {
  "/": ["index.html", "text/html"],
  "/styles.css": ["styles.css", "text/css"],
  "/app.js": ["app.js", "text/javascript"],
  "/lib.mjs": ["lib.mjs", "text/javascript"],
};
const server = createServer((req, res) => {
  if (req.url === "/stream") {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
    // One message, then close with a long retry: an open stream would keep
    // headless Chrome from ever finishing the page load.
    res.end(`retry: 3600000\ndata: ${JSON.stringify(payload)}\n\n`);
    return;
  }
  const f = FILES[req.url];
  if (!f) { res.writeHead(req.method === "POST" ? 204 : 404); res.end(); return; }
  res.writeHead(200, { "Content-Type": `${f[1]}; charset=utf-8` });
  res.end(readFileSync(join(ROOT, f[0])));
});

server.listen(0, "127.0.0.1", () => {
  const url = `http://127.0.0.1:${server.address().port}/`;
  if (process.argv.includes("--serve")) {
    console.log(`Demo dashboard: ${url}  (Ctrl-C to stop)`);
    return;
  }
  const chrome = [
    process.env.CHROME,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser",
  ].find((p) => p && existsSync(p));
  if (!chrome) {
    console.error(`No Chrome found (set CHROME=…). Serving instead — screenshot ${url} at 1440×900 by hand. Ctrl-C to stop.`);
    return;
  }
  const profile = mkdtempSync(join(tmpdir(), "pr-watch-shot-"));
  // Async on purpose: a sync spawn would block the server Chrome loads from.
  {
    const child = spawn(chrome, [
      "--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run",
      `--user-data-dir=${profile}`,
      "--window-size=1440,900", "--force-device-scale-factor=2",
      "--virtual-time-budget=4000",
      // Offline and deterministic: avatars fall back to their initials.
      "--host-resolver-rules=MAP github.com ~NOTFOUND, MAP avatars.githubusercontent.com ~NOTFOUND",
      `--screenshot=${OUT}`, url,
    ], { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    const timer = setTimeout(() => { err += "\n(timed out after 30s)"; child.kill(); }, 30_000);
    child.stderr.on("data", (d) => { err += d; });
    child.on("close", (code) => {
      clearTimeout(timer);
      rmSync(profile, { recursive: true, force: true });
      server.close();
      if (code !== 0 || !existsSync(OUT)) {
        console.error(`Chrome failed (exit ${code}):\n${err.slice(-800)}`);
        process.exit(1);
      }
      console.log(`Wrote ${OUT}`);
      process.exit(0);
    });
  }
});
