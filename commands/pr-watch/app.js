import {
  ballInCourt, bicSince, bouncesCount,
  ageStr, ageMarker,
  ciChip, mergeChip, reviewChip, priorityChip,
} from "./lib.mjs";

// Set from the `viewer` field of the first payload — see applyPayload.
let GITHUB_USER = null;

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]
  ));
}

function isBIC(pr) {
  return ballInCourt(pr, GITHUB_USER).has(GITHUB_USER);
}
function extractLinear(title) {
  const m = String(title || "").match(/[A-Z]{2,}-\d+/);
  return m ? m[0] : null;
}
const REPO_PALETTE = [
  "#5fa8ff", "#c88cff", "#7ccc9f", "#ffb86b",
  "#82d4bb", "#f28fad", "#93a6ff", "#d6c26e",
];
function repoColor(slug) {
  let h = 0;
  for (const c of slug) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return REPO_PALETTE[h % REPO_PALETTE.length];
}
function repoLabel(slug) { return slug.split("/").pop(); }
function avatarUrl(login) {
  return "https://github.com/" + encodeURIComponent(login) + ".png?size=32";
}
function loginInitial(login) {
  return String(login || "?").trim().charAt(0) || "?";
}

const LS_TIERS = "pr-watch:repoTiers";

function loadTiers() {
  try { return JSON.parse(localStorage.getItem(LS_TIERS) || "{}"); }
  catch { return {}; }
}
function getTier(repo) { return loadTiers()[repo] || "default"; }
function cycleTier(repo) {
  const t = loadTiers();
  const cur = t[repo] || "default";
  const next = cur === "default" ? "pinned" : cur === "pinned" ? "muted" : "default";
  if (next === "default") delete t[repo]; else t[repo] = next;
  localStorage.setItem(LS_TIERS, JSON.stringify(t));
}

let prevById = new Map();
let currentChanged = new Set();
let lastPrs = null;
let lastUpdated = Date.now();
let isFirstPayload = true;

function applyPayload(payload) {
  if (!payload || typeof payload !== "object" || !Array.isArray(payload.prs)) {
    console.error("unexpected payload shape", payload);
    return;
  }
  if (payload.schemaVersion !== 1) {
    document.body.innerHTML = '<pre style="padding:2rem;color:#e6edf3">pr-watch: dashboard expects schemaVersion 1, got ' + payload.schemaVersion + '. Update the dashboard files.</pre>';
    return;
  }
  if (payload.viewer) GITHUB_USER = payload.viewer;
  if (!GITHUB_USER) {
    document.body.innerHTML = '<pre style="padding:2rem;color:#e6edf3">pr-watch: viewer missing from payload. Is the poller signed in with `gh auth login`?</pre>';
    return;
  }
  const prs = payload.prs;

  const changed = new Set();
  for (const pr of prs) {
    const p = prevById.get(pr.url);
    if (!p) {
      if (!isFirstPayload) changed.add(pr.url);
    } else if (
      p.reviewDecision !== pr.reviewDecision ||
      JSON.stringify(p.reviewRequests || []) !== JSON.stringify(pr.reviewRequests || []) ||
      p.ciStatus !== pr.ciStatus ||
      p.role !== pr.role ||
      p.isDraft !== pr.isDraft ||
      p.title !== pr.title ||
      p._searchUpdatedAt !== pr._searchUpdatedAt ||
      // Ignore UNKNOWN transitions — GitHub computes these async and flickers.
      (p.mergeable !== pr.mergeable && p.mergeable !== "UNKNOWN" && pr.mergeable !== "UNKNOWN") ||
      (p.mergeStateStatus !== pr.mergeStateStatus && p.mergeStateStatus !== "UNKNOWN" && pr.mergeStateStatus !== "UNKNOWN")
    ) {
      changed.add(pr.url);
    }
  }
  currentChanged = changed;

  prevById = new Map(prs.map((p) => [p.url, p]));
  lastPrs = prs;
  lastUpdated = Date.now();
  isFirstPayload = false;
  render();
}

function render() {
  if (!lastPrs) return;
  const prs = lastPrs;
  const bic = prs.filter(isBIC);
  const wait = prs.filter((p) => !isBIC(p));

  const allRepos = new Set();
  for (const pr of prs) allRepos.add(pr.repo);
  const tierOrder = { pinned: 0, default: 1, muted: 2 };
  const repos = [...allRepos].sort((a, b) => {
    const ta = tierOrder[getTier(a)];
    const tb = tierOrder[getTier(b)];
    return ta !== tb ? ta - tb : a.localeCompare(b);
  });

  document.documentElement.style.setProperty("--col-count", String(Math.max(repos.length, 1)));
  document.getElementById("top-lane-label").textContent = "YOUR TURN (" + bic.length + ")";
  const avatar = document.getElementById("viewer-avatar");
  if (GITHUB_USER && avatar.dataset.user !== GITHUB_USER) {
    avatar.src = `https://avatars.githubusercontent.com/${GITHUB_USER}?size=40`;
    avatar.alt = GITHUB_USER;
    avatar.title = GITHUB_USER;
    avatar.dataset.user = GITHUB_USER;
  }
  document.getElementById("bottom-lane-header").textContent = "WAITING (" + wait.length + ")";
  document.getElementById("bic-count").textContent = bic.length + " your turn";
  document.title = bic.length > 0 ? "(" + bic.length + ") PR Inbox" : "PR Inbox";

  document.getElementById("top-cols").innerHTML = renderCols(repos, groupBy(bic), "top");
  document.getElementById("bottom-cols").innerHTML = renderCols(repos, groupBy(wait), "bottom");

  if (bic.length === 0) {
    const top = document.getElementById("top-cols");
    top.innerHTML = "<div class=\"empty-state\">All clear · 0 your turn</div>";
  }

  updateAgo();
}

function groupBy(list) {
  const m = new Map();
  for (const pr of list) {
    if (!m.has(pr.repo)) m.set(pr.repo, []);
    m.get(pr.repo).push(pr);
  }
  return m;
}

function renderCols(repos, byRepo, lane) {
  return repos.map((repo) => {
    const color = repoColor(repo);
    const tier = getTier(repo);
    const list = (byRepo.get(repo) || []).slice();
    const tierMarker = tier === "pinned" ? "⭐" : tier === "muted" ? "·" : "";
    const clsBase = tier === "pinned" ? "col col-pinned" : tier === "muted" ? "col col-muted" : "col";
    const cls = clsBase + (list.length === 0 ? " col-empty" : "");
    const header =
      "<div class=\"col-header\" data-repo=\"" + escapeHtml(repo) + "\" style=\"color:" + color + ";border-bottom-color:" + color + "66;background:" + color + "12\">" +
        "<span class=\"repo-dot\" style=\"background:" + color + "\"></span>" +
        "<span class=\"repo-name\" title=\"" + escapeHtml(repo) + "\">" + escapeHtml(repoLabel(repo)) + "</span>" +
        "<span class=\"tier-marker\">" + tierMarker + "</span>" +
      "</div>";

    let body = "";
    if (lane === "bottom" && tier === "muted" && list.length > 0) {
      const oldest = list.reduce((a, b) =>
        new Date(a._searchUpdatedAt) < new Date(b._searchUpdatedAt) ? a : b);
      body = "<div class=\"muted-summary\">" + list.length + " waiting · oldest " +
        ageStr(oldest._searchUpdatedAt) + "</div>";
    } else if (list.length > 0) {
      list.sort((a, b) => lane === "top"
        ? new Date(a._searchUpdatedAt) - new Date(b._searchUpdatedAt)
        : new Date(b._searchUpdatedAt) - new Date(a._searchUpdatedAt));
      body = list.map((pr) => renderPr(pr, lane, color)).join("");
    }

    return "<div class=\"" + cls + "\" style=\"border-color:" + color + "99\">" + header + body + "</div>";
  }).join("");
}

function renderPr(pr, lane, repoColorValue) {
  const isChanged = currentChanged.has(pr.url);
  const linear = extractLinear(pr.title);
  const titleClean = linear
    ? pr.title.replace(new RegExp("\\s*\\[?" + linear + "\\]?\\s*"), " ").trim()
    : pr.title;
  const linearHtml = linear
    ? "<a class=\"linear\" href=\"https://linear.app/issue/" + escapeHtml(linear) + "\" target=\"_blank\" rel=\"noopener\">" + escapeHtml(linear) + "</a>"
    : "";
  const delta = "<span class=\"delta" + (isChanged ? "" : " empty") + "\"></span>";
  const authorLogin = (pr.author && pr.author.login) ? pr.author.login : "";
  const avatar = authorLogin
    ? "<img class=\"avatar\" src=\"" + avatarUrl(authorLogin) + "\" alt=\"@" + escapeHtml(authorLogin) + "\" loading=\"lazy\" referrerpolicy=\"no-referrer\" onerror=\"this.replaceWith(Object.assign(document.createElement('span'),{className:'avatar-fallback',textContent:'" + escapeHtml(loginInitial(authorLogin)) + "'}))\">"
    : "<span class=\"avatar-fallback\">?</span>";

  const ageTs = bicSince(pr, GITHUB_USER) || pr._searchUpdatedAt;
  const age = ageMarker(ageTs);
  const ageHtml = "<span class=\"age-marker " + age.cls + "\">" + age.text + "</span>";

  let chips = "";
  if (lane === "top") {
    const ci = ciChip(pr);
    const merge = mergeChip(pr);
    const rev = reviewChip(pr, GITHUB_USER);
    const bounces = bouncesCount(pr);
    const bouncesChip = bounces > 0 ? "<span class=\"chip\" title=\"" + bounces + " 'request changes' review" + (bounces === 1 ? "" : "s") + " — this PR has bounced back to the author " + bounces + " time" + (bounces === 1 ? "" : "s") + "\">🏓 " + bounces + "</span>" : "";
    // Layout: CTA on the left (the primary signal), everything else
    // right-aligned in a meta cluster (secondary state + age).
    chips = "<div class=\"top-card-footer\">" +
      "<span class=\"chip chip-cta " + rev.cls + "\">" + rev.text + "</span>" +
      "<div class=\"meta-chips\">" +
        (ci ? "<span class=\"chip " + ci.cls + "\">" + ci.text + "</span>" : "") +
        (merge ? "<span class=\"chip " + merge.cls + "\">" + merge.text + "</span>" : "") +
        bouncesChip +
        ageHtml +
      "</div>" +
    "</div>";
  } else {
    const p = priorityChip(pr, GITHUB_USER);
    const staleWarn = age.cls === "age-ancient"
      ? "<span class=\"stale-warn\" title=\"No activity for " + escapeHtml(ageStr(ageTs)) + " — may be stuck\">!</span>"
      : "";
    chips = "<div class=\"chips\">" +
      staleWarn +
      "<span class=\"chip " + p.cls + "\">" + p.text + "</span>" +
    "</div>";
  }
  if (lane === "top") {
    // Top lane: only emit the changed-dot when actually changed, and place it
    // absolutely in the top-right corner so unchanged cards reclaim the space.
    const changedDot = isChanged ? "<span class=\"changed-dot\" title=\"Changed in latest update\"></span>" : "";
    return "<div class=\"pr role-" + pr.role + " " + age.cls + (pr.isDraft ? " draft" : "") + "\" style=\"border-left-color:" + repoColorValue + "\">" +
      changedDot +
      "<div class=\"top-card-header\">" +
        avatar +
        "<span class=\"num\"><a href=\"" + escapeHtml(pr.url) + "\" target=\"_blank\" rel=\"noopener\">#" + pr.number + "</a></span>" +
        linearHtml +
        "<span class=\"title\"><a href=\"" + escapeHtml(pr.url) + "\" target=\"_blank\" rel=\"noopener\">" +
          escapeHtml(titleClean) + "</a></span>" +
      "</div>" +
      chips +
    "</div>";
  }
  return "<div class=\"pr role-" + pr.role + (pr.isDraft ? " draft" : "") + "\" style=\"border-left-color:" + repoColorValue + "\">" +
    delta +
    avatar +
    "<span class=\"num\"><a href=\"" + escapeHtml(pr.url) + "\" target=\"_blank\" rel=\"noopener\">#" + pr.number + "</a></span>" +
    linearHtml +
    "<span class=\"title\"><a href=\"" + escapeHtml(pr.url) + "\" target=\"_blank\" rel=\"noopener\">" +
      escapeHtml(titleClean) + "</a></span>" +
    chips +
  "</div>";
}

function formatClock(ts) {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return hh + ":" + mm;
}
function relativeAgo(ts) {
  const ms = Date.now() - ts;
  const m = Math.floor(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return m + "m ago";
  const h = Math.floor(m / 60);
  const rm = m % 60;
  if (h < 24) return rm === 0 ? h + "h ago" : h + "h " + rm + "m ago";
  const d = Math.floor(h / 24);
  const rh = h % 24;
  return rh === 0 ? d + "d ago" : d + "d " + rh + "h ago";
}
function updateAgo() {
  document.getElementById("updated-ago").textContent =
    "↻ " + formatClock(lastUpdated) + " (" + relativeAgo(lastUpdated) + ")";
  document.getElementById("change-legend").innerHTML =
    "<span class=\"header-delta-dot\"></span>" + currentChanged.size + " changed in latest update";
}
setInterval(updateAgo, 30000);


document.addEventListener("contextmenu", (e) => {
  const h = e.target.closest(".col-header");
  if (!h) return;
  e.preventDefault();
  cycleTier(h.dataset.repo);
  render();
});

const es = new EventSource("/stream");
es.addEventListener("message", (e) => {
  try { applyPayload(JSON.parse(e.data)); }
  catch (err) { console.error("bad payload", err); }
});
