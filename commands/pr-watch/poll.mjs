#!/usr/bin/env node
// poll.mjs — version 0.12.0
// source: https://github.com/anneveling/ai-kit/tree/main/commands/pr-watch
// Polls GitHub for open PRs you authored or are requested to review.
// Emits JSON change-event lines to stdout when anything changes.
// Writes current.json with full current state on every poll.
// Also serves an ambient dashboard at http://localhost:$PR_WATCH_PORT (default 7654).
//
// Two modes:
//   /pr-watch in Claude  — Claude renders the full interactive inbox via Monitor tool
//   node poll.mjs        — standalone: browser dashboard only, no Claude session needed
//
// Usage:
//   node poll.mjs
//   OWNER=your-org node poll.mjs
//   POLL_INTERVAL=60 node poll.mjs
//   STOP_AT=17:30 node poll.mjs
//   HOURS=4 node poll.mjs
//   PR_WATCH_PORT=8000 node poll.mjs
//   PR_WATCH_NO_DASHBOARD=1 node poll.mjs
//   PR_WATCH_NO_OPEN=1 node poll.mjs
//   node poll.mjs --reset

import { execSync, spawn } from "child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { createServer } from "http";
import { homedir } from "os";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { buildPayload, ciSummary, computeEvents, computeStopTime, diffPr } from "./lib.mjs";

const SCHEMA_VERSION = 1;
const POLLER_VERSION = "0.12.0";
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));

// ── Preflight ────────────────────────────────────────────────────────────────

function preflight() {
  const errors = [];
  let ghFound = true;

  const [major] = process.versions.node.split(".").map(Number);
  if (major < 18) {
    errors.push(`  ✗ Node.js 18+ required (you have ${process.version}) — https://nodejs.org`);
  }

  try {
    execSync("gh --version", { stdio: "pipe" });
  } catch {
    ghFound = false;
    errors.push("  ✗ gh CLI not found — install from https://cli.github.com");
  }

  if (ghFound) {
    try {
      execSync("gh auth status", { stdio: "pipe" });
    } catch {
      errors.push("  ✗ gh CLI is not authenticated — run: gh auth login");
    }
  }

  if (errors.length) {
    process.stderr.write("pr-watch: missing prerequisites:\n" + errors.join("\n") + "\n");
    process.exit(1);
  }
}

preflight();

// ── Config ───────────────────────────────────────────────────────────────────

const OWNER = process.env.OWNER;
const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL ?? "120", 10);
const DASHBOARD_PORT = parseInt(process.env.PR_WATCH_PORT ?? "7654", 10);
const DASHBOARD_ENABLED = !process.env.PR_WATCH_NO_DASHBOARD;

const STATE_DIR = process.env.STATE_DIR ?? join(homedir(), ".claude", "pr-watch");
mkdirSync(STATE_DIR, { recursive: true });
const STATE_FILE = join(STATE_DIR, "state.json");
const CURRENT_FILE = join(STATE_DIR, "current.json");

const STOP_TIME = computeStopTime();
const stopLabel = STOP_TIME.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

const WARN_THRESHOLDS_MS = [10 * 60_000, 5 * 60_000, 2 * 60_000];
const warnedAt = new Set();

// ── GitHub field lists ────────────────────────────────────────────────────────

const SEARCH_FIELDS = "number,title,url,repository,author,isDraft,state,updatedAt";
const VIEW_FIELDS = "number,title,url,author,isDraft,reviewDecision,statusCheckRollup,reviews,reviewRequests,state,createdAt,updatedAt,mergeable,mergeStateStatus";

// ── Helpers ──────────────────────────────────────────────────────────────────

// Async gh call. We use shell:true so callsites can keep their existing
// string-with-quoted-args form. Returns parsed JSON or null on any failure
// (non-zero exit, parse error, missing gh).
function gh(args) {
  return new Promise((resolve) => {
    let out = "";
    const child = spawn(`gh ${args}`, { shell: true, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.on("data", (d) => { out += d; });
    child.on("close", () => {
      try { resolve(JSON.parse(out)); } catch { resolve(null); }
    });
    child.on("error", () => resolve(null));
  });
}

function ts() {
  return new Date().toISOString().slice(0, 19) + "Z";
}

function emit(event) {
  process.stdout.write(JSON.stringify({ ...event, stopAt: STOP_TIME.toISOString() }) + "\n");
}

// ── Data fetching ─────────────────────────────────────────────────────────────

async function fetchSummaries() {
  const ownerFlag = OWNER ? `--owner ${OWNER}` : "";
  // Three search queries can run in parallel — independent of each other.
  // PRs where you've already submitted a review drop off --review-requested,
  // so --reviewed-by keeps them tracked until truly closed.
  const [mine, review, reviewed] = (await Promise.all([
    gh(`search prs --state open --author @me ${ownerFlag} --json "${SEARCH_FIELDS}" --limit 100`),
    gh(`search prs --state open --review-requested @me ${ownerFlag} --json "${SEARCH_FIELDS}" --limit 100`),
    gh(`search prs --state open --reviewed-by @me ${ownerFlag} --json "${SEARCH_FIELDS}" --limit 100`),
  ])).map((r) => r ?? []);

  const byUrl = new Map();
  for (const pr of mine)     byUrl.set(pr.url, { ...pr, role: "author" });
  for (const pr of review)   if (!byUrl.has(pr.url)) byUrl.set(pr.url, { ...pr, role: "reviewer" });
  for (const pr of reviewed) if (!byUrl.has(pr.url)) byUrl.set(pr.url, { ...pr, role: "reviewer" });
  return Array.from(byUrl.values());
}

async function enrichPr(url, role, repo, me) {
  const details = await gh(`pr view "${url}" --json "${VIEW_FIELDS}"`);
  if (!details) return null;

  // Filter out:
  //   - self (you can't review your own PR formally, and per-reviewer logic
  //     handles your own latest review separately via pr.reviews)
  //   - DISMISSED reviews (stale approvals after force-push, etc. — no signal)
  //   - bot reviews (Dependabot, Codecov etc. — they don't drive ball-in-court)
  const latestReviews = Object.values(
    (details.reviews ?? [])
      .filter((r) => r.author?.login && r.author.login !== me)
      .filter((r) => r.state !== "DISMISSED")
      .filter((r) => !r.author?.is_bot)
      .reduce((acc, r) => {
        const login = r.author.login;
        if (!acc[login] || r.submittedAt > acc[login].submittedAt) acc[login] = r;
        return acc;
      }, {})
  ).map((r) => ({ login: r.author.login, state: r.state, submittedAt: r.submittedAt }));

  return {
    ...details,
    role,
    repo,
    ciStatus: ciSummary(details.statusCheckRollup),
    latestReviews,
    reviewRequests: (details.reviewRequests ?? []).map((r) => r.login),
  };
}

// ── State ─────────────────────────────────────────────────────────────────────

function loadState() {
  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf8"));
  } catch {
    return {};
  }
}

function saveState(state) {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function saveCurrent(prs, viewer) {
  const payload = buildPayload(prs, viewer, { schemaVersion: SCHEMA_VERSION, pollerVersion: POLLER_VERSION });
  writeFileSync(CURRENT_FILE, JSON.stringify(payload, null, 2));
  broadcastDashboard(payload);
}

// ── Dashboard server ─────────────────────────────────────────────────────────

const INDEX_FILE  = join(SCRIPT_DIR, "index.html");
const CSS_FILE    = join(SCRIPT_DIR, "styles.css");
const APP_JS_FILE = join(SCRIPT_DIR, "app.js");
const LIB_MJS_FILE = join(SCRIPT_DIR, "lib.mjs");

const sseClients = new Set();
let lastPayloadJson = "null";

function broadcastDashboard(payload) {
  if (!DASHBOARD_ENABLED) return;
  lastPayloadJson = JSON.stringify(payload);
  const msg = `data: ${lastPayloadJson}\n\n`;
  for (const res of sseClients) {
    try { res.write(msg); } catch { /* client gone */ }
  }
}

function startDashboard(viewer) {
  if (!DASHBOARD_ENABLED) return;

  const missing = ["index.html", "styles.css", "app.js"].filter((f) => !existsSync(join(SCRIPT_DIR, f)));
  if (missing.length > 0) {
    console.error(`pr-watch: dashboard files missing (${missing.join(", ")}) — browser dashboard disabled.`);
    console.error(`  Re-run installation to add them, or set PR_WATCH_NO_DASHBOARD=1 to silence this.`);
    return;
  }

  try {
    lastPayloadJson = readFileSync(CURRENT_FILE, "utf8");
  } catch { /* no prior payload yet */ }

  // Local dashboard — files change between poller restarts as we iterate.
  // Disable caching so a new tab never picks up stale JS/CSS/HTML.
  const NO_CACHE = { "Cache-Control": "no-store, max-age=0" };

  const server = createServer((req, res) => {
    if (req.method !== "GET") { res.writeHead(404); res.end(); return; }
    try {
      if (req.url === "/") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", ...NO_CACHE });
        res.end(readFileSync(INDEX_FILE, "utf8"));
        return;
      }
      if (req.url === "/styles.css") {
        res.writeHead(200, { "Content-Type": "text/css; charset=utf-8", ...NO_CACHE });
        res.end(readFileSync(CSS_FILE, "utf8"));
        return;
      }
      if (req.url === "/app.js") {
        res.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8", ...NO_CACHE });
        res.end(readFileSync(APP_JS_FILE, "utf8"));
        return;
      }
      if (req.url === "/lib.mjs") {
        res.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8", ...NO_CACHE });
        res.end(readFileSync(LIB_MJS_FILE, "utf8"));
        return;
      }
      if (req.url === "/current.json") {
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", ...NO_CACHE });
        res.end(lastPayloadJson);
        return;
      }
      if (req.url === "/stream") {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
        });
        res.write(`data: ${lastPayloadJson}\n\n`);
        sseClients.add(res);
        req.on("close", () => sseClients.delete(res));
        return;
      }
    } catch (err) {
      res.writeHead(500);
      res.end(`dashboard error: ${err.message}`);
      return;
    }
    res.writeHead(404);
    res.end();
  });

  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      console.error(`pr-watch: port ${DASHBOARD_PORT} already in use — dashboard disabled. Set PR_WATCH_PORT to a free port, or PR_WATCH_NO_DASHBOARD=1 to silence this.`);
      return;
    }
    console.error(`pr-watch: dashboard server error: ${err.message}`);
  });

  server.listen(DASHBOARD_PORT, () => {
    const url = `http://localhost:${DASHBOARD_PORT}`;
    console.error("");
    console.error(`  ┌─ pr-watch dashboard ─────────────────────────────`);
    console.error(`  │  ${url}`);
    console.error(`  │  (viewer: ${viewer})`);
    console.error(`  └──────────────────────────────────────────────────`);
    console.error("");
    openBrowser(url);
  });
}

function openBrowser(url) {
  if (process.env.PR_WATCH_NO_OPEN) return;
  // Skip when there's clearly no GUI (CI, SSH sessions without display forwarding).
  if (process.env.CI) return;
  if (process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) return;

  const cmd = process.platform === "darwin" ? "open"
    : process.platform === "win32" ? "cmd"
    : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];

  try {
    const child = spawn(cmd, args, { detached: true, stdio: "ignore" });
    child.on("error", () => { /* opener missing — silent */ });
    child.unref();
  } catch { /* silent */ }
}

// ── Poll ──────────────────────────────────────────────────────────────────────

async function pollOnce(isFirstRun, me) {
  console.error(`[${new Date().toISOString().slice(11, 19)}Z] polling...`);

  const summaries = await fetchSummaries();
  const prevState = loadState();

  // `--review-requested @me` drops a PR once you submit a review, even if it's
  // still open and awaiting the author's response. Re-add any dropped PR that's
  // actually still open so it stays tracked until truly closed/merged.
  if (!isFirstRun) {
    const summaryUrls = new Set(summaries.map((s) => s.url));
    for (const [url, prev] of Object.entries(prevState)) {
      if (!summaryUrls.has(url)) {
        const actual = await gh(`pr view "${url}" --json state`);
        if (actual?.state === "OPEN") {
          console.error(`  keeping ${url} (still open, dropped from search)`);
          summaries.push({ url, role: prev.role, repository: { nameWithOwner: prev.repo } });
        }
      }
    }
  }

  // Skip the per-PR `gh pr view` call when the PR's updatedAt hasn't changed
  // since we last enriched it. GitHub bumps updatedAt on any PR-side event
  // (push, comment, review, label, CI completion), so we only miss state
  // shifts driven by main-branch motion (e.g. mergeStateStatus flipping to
  // BEHIND with no PR activity). Acceptable lag — will resolve on next event.
  const enrichedMap = {};
  for (const { url, role, repository, updatedAt } of summaries) {
    const repo = repository.nameWithOwner;
    const prev = prevState[url];
    if (prev && updatedAt && prev._searchUpdatedAt === updatedAt && prev.mergeable !== "UNKNOWN") {
      // role can change between polls (e.g. you commented on someone's PR and
      // now appear via --reviewed-by). Keep the rest of the cached enrichment.
      enrichedMap[url] = { ...prev, role, repo };
      continue;
    }
    const enriched = await enrichPr(url, role, repo, me);
    if (!enriched) {
      console.error(`  warn: could not enrich ${url}, keeping previous state`);
      if (prev) enrichedMap[url] = prev;
      continue;
    }
    enrichedMap[url] = enriched;
  }

  const { nextState, events } = computeEvents(summaries, enrichedMap, prevState, isFirstRun);

  saveState(nextState);
  saveCurrent(Object.values(nextState), me);
  for (const event of events) emit(event);

  if (isFirstRun) {
    const count = Object.keys(nextState).length;
    console.error(`Initialized: tracking ${count} PRs. Polling every ${POLL_INTERVAL}s. Auto-stop at ${stopLabel}.`);
    emit({ event: "initialized", ts: ts(), count });
  }
}

// ── Entrypoint ────────────────────────────────────────────────────────────────

if (process.argv.includes("--reset")) {
  writeFileSync(STATE_FILE, "{}");
  writeFileSync(CURRENT_FILE, JSON.stringify(buildPayload([], null, { schemaVersion: SCHEMA_VERSION, pollerVersion: POLLER_VERSION }), null, 2));
  console.error("State reset.");
  process.exit(0);
}

const me = execSync("gh api user --jq '.login'", { encoding: "utf8" }).trim();
console.error(`PR poller | ${OWNER ? `org=${OWNER}` : "all orgs"} | interval=${POLL_INTERVAL}s | user=${me}`);
console.error(`State: ${STATE_FILE}  Current: ${CURRENT_FILE}`);
console.error(`Auto-stop: ${stopLabel}`);

startDashboard(me);

// Always treat startup as first run so stale state from a previous session
// doesn't trigger spurious new/changed/closed events on day 2.
let isFirstRun = true;

while (true) {
  const msLeft = STOP_TIME.getTime() - Date.now();

  if (msLeft <= 0) {
    emit({ event: "stopping", ts: ts(), reason: "end_of_day" });
    console.error(`Stop time ${stopLabel} reached — exiting.`);
    process.exit(0);
  }

  for (const threshold of WARN_THRESHOLDS_MS) {
    if (!warnedAt.has(threshold) && msLeft <= threshold) {
      warnedAt.add(threshold);
      emit({ event: "warning", ts: ts(), minutesLeft: Math.ceil(msLeft / 60_000) });
    }
  }

  await pollOnce(isFirstRun, me);
  isFirstRun = false;
  await new Promise((r) => setTimeout(r, POLL_INTERVAL * 1000));
}
