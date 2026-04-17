#!/usr/bin/env node
// poll.mjs
// Polls a GitHub org for open PRs you authored or are requested to review.
// Emits JSON change-event lines to stdout when anything changes.
// Writes current.json with full current state on every poll.
//
// Usage:
//   OWNER=your-org node poll.mjs
//   OWNER=your-org POLL_INTERVAL=60 node poll.mjs
//   OWNER=your-org STOP_AT=17:30 node poll.mjs   # stop at clock time
//   OWNER=your-org HOURS=4 node poll.mjs          # stop after N hours
//   OWNER=your-org node poll.mjs --reset

import { execSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const OWNER = process.env.OWNER;
if (!OWNER) {
  process.stderr.write("Error: OWNER environment variable is required (e.g. OWNER=your-org)\n");
  process.exit(1);
}

const STATE_DIR = process.env.STATE_DIR ?? join(homedir(), ".claude", "pr-watch");
mkdirSync(STATE_DIR, { recursive: true });

const STATE_FILE = join(STATE_DIR, "state.json");
const CURRENT_FILE = join(STATE_DIR, "current.json");
const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL ?? "120", 10);

// Smart stop time:
//   HOURS=N     → now + N hours (explicit duration)
//   STOP_AT=HH:MM → that clock time today
//   default     → if started 07:00–18:00 local: stop at 18:00; otherwise: +4h
function computeStopTime() {
  if (process.env.HOURS) {
    return new Date(Date.now() + parseFloat(process.env.HOURS) * 3600_000);
  }
  if (process.env.STOP_AT) {
    const [h, m] = process.env.STOP_AT.split(":").map(Number);
    const t = new Date();
    t.setHours(h, m, 0, 0);
    return t;
  }
  const hour = new Date().getHours();
  if (hour >= 7 && hour < 18) {
    const t = new Date();
    t.setHours(18, 0, 0, 0);
    return t;
  }
  return new Date(Date.now() + 4 * 3600_000);
}

const STOP_TIME = computeStopTime();
const stopLabel = STOP_TIME.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

// Warning thresholds in ms before stop time — fires once each
const WARN_THRESHOLDS = [10 * 60_000, 5 * 60_000, 2 * 60_000];
const warnedAt = new Set();

const SEARCH_FIELDS = "number,title,url,repository,author,isDraft,updatedAt,state";
const VIEW_FIELDS = "number,title,url,author,isDraft,reviewDecision,statusCheckRollup,reviews,reviewRequests,state,createdAt";

function gh(args) {
  try {
    return JSON.parse(execSync(`gh ${args}`, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }));
  } catch {
    return null;
  }
}

function log(msg) {
  process.stderr.write(`${msg}\n`);
}

function ts() {
  return new Date().toISOString().replace(/\.\d+Z$/, "Z");
}

// All events include stopAt so the command can always show remaining time
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

function fetchPrList() {
  const mine = gh(`search prs --state open --author @me --owner ${OWNER} --json "${SEARCH_FIELDS}" --limit 100`) ?? [];
  const review = gh(`search prs --state open --review-requested @me --owner ${OWNER} --json "${SEARCH_FIELDS}" --limit 100`) ?? [];

  // Deduplicate by url, prefer 'author' role when a PR appears in both
  const map = new Map();
  for (const pr of mine) map.set(pr.url, { ...pr, role: "author" });
  for (const pr of review) {
    if (!map.has(pr.url)) map.set(pr.url, { ...pr, role: "reviewer" });
  }
  return Array.from(map.values());
}

function enrichPr(url, role, repo, me) {
  const details = gh(`pr view "${url}" --json "${VIEW_FIELDS}"`);
  if (!details) return null;

  // Latest review state per reviewer, excluding self
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

function loadState() {
  if (!existsSync(STATE_FILE)) return {};
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

async function pollOnce(isFirstRun, me) {
  log(`[${new Date().toISOString().slice(11, 19)}Z] polling...`);

  const currentList = fetchPrList();
  const prevState = loadState();
  const newState = {};
  const events = [];

  for (const summary of currentList) {
    const { url, updatedAt, role, repository } = summary;
    const repo = repository.nameWithOwner;
    const prev = prevState[url];

    let enriched;
    if (!prev || prev._searchUpdatedAt !== updatedAt) {
      enriched = enrichPr(url, role, repo, me);
      if (!enriched) {
        log(`  warn: could not enrich ${url}`);
        continue;
      }

      if (!isFirstRun) {
        if (!prev) {
          events.push({ event: "new", ts: ts(), repo, pr: enriched.number, title: enriched.title, url, role, reviewDecision: enriched.reviewDecision, isDraft: enriched.isDraft, ciStatus: enriched.ciStatus });
        } else {
          const changes = {};
          if (prev.reviewDecision !== enriched.reviewDecision) changes.reviewDecision = { from: prev.reviewDecision, to: enriched.reviewDecision };
          if (prev.isDraft !== enriched.isDraft) changes.isDraft = { from: prev.isDraft, to: enriched.isDraft };
          if (prev.ciStatus !== enriched.ciStatus) changes.ciStatus = { from: prev.ciStatus, to: enriched.ciStatus };
          const prevReviews = JSON.stringify((prev.latestReviews ?? []).map(r => `${r.login}:${r.state}`).sort());
          const newReviews = JSON.stringify((enriched.latestReviews ?? []).map(r => `${r.login}:${r.state}`).sort());
          if (prevReviews !== newReviews) changes.latestReviews = { from: prev.latestReviews, to: enriched.latestReviews };
          if (Object.keys(changes).length > 0) {
            events.push({ event: "changed", ts: ts(), repo, pr: enriched.number, title: enriched.title, url, role, reviewDecision: enriched.reviewDecision, isDraft: enriched.isDraft, ciStatus: enriched.ciStatus, changes });
          }
        }
      }
    } else {
      enriched = prev;
    }

    newState[url] = { ...enriched, _searchUpdatedAt: updatedAt };
  }

  // Detect closed PRs (in prev state but not in current list)
  if (!isFirstRun) {
    const currentUrls = new Set(currentList.map((p) => p.url));
    for (const [url, prev] of Object.entries(prevState)) {
      if (!currentUrls.has(url)) {
        events.push({ event: "closed", ts: ts(), repo: prev.repo, pr: prev.number, title: prev.title, url, role: prev.role });
      }
    }
  }

  saveState(newState);
  saveCurrent(Object.values(newState));

  for (const event of events) emit(event);

  if (isFirstRun) {
    const count = Object.keys(newState).length;
    log(`Initialized: tracking ${count} PRs. Polling every ${POLL_INTERVAL}s. Auto-stop at ${stopLabel}.`);
    emit({ event: "initialized", ts: ts(), count });
  }
}

// --reset flag
if (process.argv.includes("--reset")) {
  if (existsSync(STATE_FILE)) { writeFileSync(STATE_FILE, "{}"); }
  if (existsSync(CURRENT_FILE)) { writeFileSync(CURRENT_FILE, "[]"); }
  log("State reset.");
}

const me = execSync("gh api user --jq '.login'", { encoding: "utf8" }).trim();
log(`PR poller | org=${OWNER} | interval=${POLL_INTERVAL}s | user=${me}`);
log(`State: ${STATE_FILE}  Current: ${CURRENT_FILE}`);
log(`Auto-stop: ${stopLabel}`);

let isFirstRun = !existsSync(STATE_FILE) || readFileSync(STATE_FILE, "utf8").trim() === "{}";

while (true) {
  const msLeft = STOP_TIME.getTime() - Date.now();

  if (msLeft <= 0) {
    emit({ event: "stopping", ts: ts(), reason: "end_of_day" });
    log(`Stop time ${stopLabel} reached — exiting.`);
    process.exit(0);
  }

  // Emit countdown warnings once each at 10m, 5m, 2m
  for (const threshold of WARN_THRESHOLDS) {
    if (!warnedAt.has(threshold) && msLeft <= threshold) {
      warnedAt.add(threshold);
      emit({ event: "warning", ts: ts(), minutesLeft: Math.ceil(msLeft / 60_000) });
    }
  }

  await pollOnce(isFirstRun, me);
  isFirstRun = false;
  await new Promise((r) => setTimeout(r, POLL_INTERVAL * 1000));
}
