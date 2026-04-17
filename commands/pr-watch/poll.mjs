#!/usr/bin/env node
// poll.mjs
// Polls GitHub for open PRs you authored or are requested to review.
// Emits JSON change-event lines to stdout when anything changes.
// Writes current.json with full current state on every poll.
//
// Usage:
//   node poll.mjs
//   OWNER=your-org node poll.mjs
//   POLL_INTERVAL=60 node poll.mjs
//   STOP_AT=17:30 node poll.mjs
//   HOURS=4 node poll.mjs
//   node poll.mjs --reset

import { execSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

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

const STATE_DIR = process.env.STATE_DIR ?? join(homedir(), ".claude", "pr-watch");
mkdirSync(STATE_DIR, { recursive: true });
const STATE_FILE = join(STATE_DIR, "state.json");
const CURRENT_FILE = join(STATE_DIR, "current.json");

// Smart stop time:
//   HOURS=N       → now + N hours
//   STOP_AT=HH:MM → that clock time today
//   default       → 18:00 if started 07:00–18:00 local, otherwise +4h
function computeStopTime() {
  if (process.env.HOURS) {
    return new Date(Date.now() + parseFloat(process.env.HOURS) * 3600_000);
  }
  if (process.env.STOP_AT) {
    const [h, m] = process.env.STOP_AT.split(":").map(Number);
    const stopDate = new Date();
    stopDate.setHours(h, m, 0, 0);
    return stopDate;
  }
  const hour = new Date().getHours();
  if (hour >= 7 && hour < 18) {
    const stopDate = new Date();
    stopDate.setHours(18, 0, 0, 0);
    return stopDate;
  }
  return new Date(Date.now() + 4 * 3600_000);
}

const STOP_TIME = computeStopTime();
const stopLabel = STOP_TIME.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

const WARN_THRESHOLDS_MS = [10 * 60_000, 5 * 60_000, 2 * 60_000];
const warnedAt = new Set();

// ── GitHub field lists ────────────────────────────────────────────────────────

const SEARCH_FIELDS = "number,title,url,repository,author,isDraft,updatedAt,state";
const VIEW_FIELDS = "number,title,url,author,isDraft,reviewDecision,statusCheckRollup,reviews,reviewRequests,state,createdAt";

// ── Helpers ──────────────────────────────────────────────────────────────────

function gh(args) {
  try {
    return JSON.parse(execSync(`gh ${args}`, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }));
  } catch {
    return null;
  }
}

function ts() {
  return new Date().toISOString().slice(0, 19) + "Z";
}

function emit(event) {
  process.stdout.write(JSON.stringify({ ...event, stopAt: STOP_TIME.toISOString() }) + "\n");
}

function ciSummary(checkRollup) {
  if (!checkRollup?.length) return null;
  const states = checkRollup.map((c) => c.status ?? c.conclusion ?? "PENDING");
  if (states.some((s) => ["FAILURE", "ERROR", "ACTION_REQUIRED"].includes(s))) return "FAILURE";
  if (states.some((s) => ["IN_PROGRESS", "QUEUED", "PENDING", "WAITING"].includes(s))) return "PENDING";
  if (states.every((s) => ["SUCCESS", "NEUTRAL", "SKIPPED", "COMPLETED"].includes(s))) return "SUCCESS";
  return "PENDING";
}

// ── Data fetching ─────────────────────────────────────────────────────────────

function fetchSummaries() {
  const ownerFlag = OWNER ? `--owner ${OWNER}` : "";
  const mine   = gh(`search prs --state open --author @me ${ownerFlag} --json "${SEARCH_FIELDS}" --limit 100`) ?? [];
  const review = gh(`search prs --state open --review-requested @me ${ownerFlag} --json "${SEARCH_FIELDS}" --limit 100`) ?? [];

  const byUrl = new Map();
  for (const pr of mine)   byUrl.set(pr.url, { ...pr, role: "author" });
  for (const pr of review) if (!byUrl.has(pr.url)) byUrl.set(pr.url, { ...pr, role: "reviewer" });
  return Array.from(byUrl.values());
}

function enrichPr(url, role, repo, me) {
  const details = gh(`pr view "${url}" --json "${VIEW_FIELDS}"`);
  if (!details) return null;

  const latestReviews = Object.values(
    (details.reviews ?? [])
      .filter((r) => r.author?.login !== me)
      .reduce((acc, r) => {
        const login = r.author?.login;
        if (!login) return acc;
        if (!acc[login] || r.submittedAt > acc[login].submittedAt) acc[login] = r;
        return acc;
      }, {})
  ).map((r) => ({ login: r.author.login, state: r.state }));

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

function saveCurrent(prs) {
  writeFileSync(CURRENT_FILE, JSON.stringify(prs, null, 2));
}

// ── Poll ──────────────────────────────────────────────────────────────────────

function pollOnce(isFirstRun, me) {
  console.error(`[${new Date().toISOString().slice(11, 19)}Z] polling...`);

  const summaries = fetchSummaries();
  const prevState = loadState();
  const nextState = {};
  const events = [];

  for (const summary of summaries) {
    const { url, updatedAt, role, repository } = summary;
    const repo = repository.nameWithOwner;
    const prev = prevState[url];

    let enriched;
    if (!prev || prev._searchUpdatedAt !== updatedAt) {
      enriched = enrichPr(url, role, repo, me);
      if (!enriched) {
        console.error(`  warn: could not enrich ${url}`);
        continue;
      }
      if (!isFirstRun) {
        if (!prev) {
          events.push({
            event: "new", ts: ts(), repo, pr: enriched.number, title: enriched.title,
            url, role, reviewDecision: enriched.reviewDecision, isDraft: enriched.isDraft,
            ciStatus: enriched.ciStatus,
          });
        } else {
          const changes = {};
          if (prev.reviewDecision !== enriched.reviewDecision) changes.reviewDecision = { from: prev.reviewDecision, to: enriched.reviewDecision };
          if (prev.isDraft !== enriched.isDraft)               changes.isDraft         = { from: prev.isDraft,         to: enriched.isDraft };
          if (prev.ciStatus !== enriched.ciStatus)             changes.ciStatus        = { from: prev.ciStatus,        to: enriched.ciStatus };

          const prevReviewSig = JSON.stringify((prev.latestReviews     ?? []).map((r) => `${r.login}:${r.state}`).sort());
          const nextReviewSig = JSON.stringify((enriched.latestReviews ?? []).map((r) => `${r.login}:${r.state}`).sort());
          if (prevReviewSig !== nextReviewSig) changes.latestReviews = { from: prev.latestReviews, to: enriched.latestReviews };

          if (Object.keys(changes).length > 0) {
            events.push({
              event: "changed", ts: ts(), repo, pr: enriched.number, title: enriched.title,
              url, role, reviewDecision: enriched.reviewDecision, isDraft: enriched.isDraft,
              ciStatus: enriched.ciStatus, changes,
            });
          }
        }
      }
    } else {
      enriched = prev;
    }

    nextState[url] = { ...enriched, _searchUpdatedAt: updatedAt };
  }

  if (!isFirstRun) {
    const currentUrls = new Set(summaries.map((p) => p.url));
    for (const [url, prev] of Object.entries(prevState)) {
      if (!currentUrls.has(url)) {
        events.push({ event: "closed", ts: ts(), repo: prev.repo, pr: prev.number, title: prev.title, url, role: prev.role });
      }
    }
  }

  saveState(nextState);
  saveCurrent(Object.values(nextState));
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
  writeFileSync(CURRENT_FILE, "[]");
  console.error("State reset.");
  process.exit(0);
}

const me = execSync("gh api user --jq '.login'", { encoding: "utf8" }).trim();
console.error(`PR poller | ${OWNER ? `org=${OWNER}` : "all orgs"} | interval=${POLL_INTERVAL}s | user=${me}`);
console.error(`State: ${STATE_FILE}  Current: ${CURRENT_FILE}`);
console.error(`Auto-stop: ${stopLabel}`);

let isFirstRun = !existsSync(STATE_FILE) || readFileSync(STATE_FILE, "utf8").trim() === "{}";

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

  pollOnce(isFirstRun, me);
  isFirstRun = false;
  await new Promise((r) => setTimeout(r, POLL_INTERVAL * 1000));
}
