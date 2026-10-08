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

// Fake people get drawn avatars: a line face on their own colour, with a
// different hairstyle each. The served app.js points avatar URLs here instead
// of GitHub (the real dashboard is untouched).
const PEOPLE = {
  ghost: { bg: "#5b8def", hair: "short", glasses: false },
  wren:  { bg: "#a86fe0", hair: "bun",   glasses: false },
  toby:  { bg: "#d9536f", hair: "none",  glasses: true },
  maya:  { bg: "#2b8fa8", hair: "long",  glasses: false },
};
// No greens or oranges: those are the review-verdict ring colours.
const FALLBACK_BG = ["#5b8def", "#a86fe0", "#d9536f", "#2b8fa8", "#7a6ff0"];
function avatarSvg(login) {
  const p = PEOPLE[login] ?? {
    bg: FALLBACK_BG[[...login].reduce((h, c) => h + c.charCodeAt(0), 0) % FALLBACK_BG.length],
    hair: "short", glasses: false,
  };
  const ink = 'fill="none" stroke="#fff" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"';
  const hair = {
    none: "",
    short: `<path ${ink} d="M19 25c1-8 6-12 13-12s12 4 13 12"/>`,
    bun: `<path ${ink} d="M19 25c1-8 6-12 13-12s12 4 13 12"/><circle ${ink} cx="32" cy="9" r="4"/>`,
    long: `<path ${ink} d="M19 33c-2-14 4-21 13-21s15 7 13 21"/>`,
  }[p.hair];
  const eyes = p.glasses
    ? `<circle ${ink} cx="26" cy="30" r="4"/><circle ${ink} cx="38" cy="30" r="4"/><path ${ink} d="M30 30h4"/>`
    : `<circle fill="#fff" cx="26.5" cy="30" r="2.6"/><circle fill="#fff" cx="37.5" cy="30" r="2.6"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` +
    `<circle cx="32" cy="32" r="32" fill="${p.bg}"/>` +
    `<circle ${ink} cx="32" cy="31" r="13"/>${hair}${eyes}` +
    `<path ${ink} d="M27 37c3 3 7 3 10 0"/>` +
    `<path ${ink} d="M14 60c2-9 9-14 18-14s16 5 18 14"/></svg>`;
}
const AVATAR_SWAPS = [
  ['"https://github.com/" + encodeURIComponent(login) + ".png?size=32"', '"/avatar/" + encodeURIComponent(login)'],
  ["`https://avatars.githubusercontent.com/${GITHUB_USER}?size=40`", '"/avatar/" + encodeURIComponent(GITHUB_USER)'],
];
function demoAppJs() {
  let js = readFileSync(join(ROOT, "app.js"), "utf8");
  for (const [from, to] of AVATAR_SWAPS) {
    if (!js.includes(from)) throw new Error(`screenshot.mjs: avatar URL changed in app.js, update AVATAR_SWAPS: ${from}`);
    js = js.replace(from, to);
  }
  return js;
}
demoAppJs(); // fail fast, before starting Chrome

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
  if (req.url.startsWith("/avatar/")) {
    res.writeHead(200, { "Content-Type": "image/svg+xml" });
    res.end(avatarSvg(decodeURIComponent(req.url.slice("/avatar/".length))));
    return;
  }
  if (req.url === "/app.js") {
    res.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8" });
    res.end(demoAppJs());
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
      // Offline and deterministic: nothing may reach GitHub.
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
