import {
  ballInCourt, bicSince, bouncesCount,
  ageStr, ageMarker,
  ciChip, mergeChip, reviewChip, priorityChip, ctaChip,
  claudeLinks, claudePrompt,
} from "./lib.mjs";

// Set from the `viewer` field of the first payload — see applyPayload.
let GITHUB_USER = null;

const REPO_URL = "https://github.com/anneveling/ai-kit/tree/main/commands/pr-watch";

function updateVersionLink(pollerVersion) {
  const el = document.getElementById("version-link");
  if (!el) return;
  el.href = REPO_URL;
  el.textContent = pollerVersion ? "v" + pollerVersion : "v—";
}

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

// ── Open in Claude ───────────────────────────────────────────────────────────
// Where the action chips open Claude: the saved choice ($STATE_DIR/config.json,
// set with the header button) or else the poller's startup guess.
let claudeTarget = null;      // saved: "desktop" | "cli" | null
let detectedTarget = null;    // guess from installed handlers

// Target icons: a warm "shiny" monitor for the desktop app, a plain
// black-and-white >_ window for the terminal.
const DESKTOP_ICON =
  "<svg class=\"target-icon\" viewBox=\"0 0 24 24\" width=\"16\" height=\"16\" aria-hidden=\"true\">" +
    "<defs><linearGradient id=\"pw-screen\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\">" +
      "<stop offset=\"0\" stop-color=\"#f4b08f\"/><stop offset=\"1\" stop-color=\"#d97757\"/></linearGradient></defs>" +
    "<rect x=\"2\" y=\"3\" width=\"20\" height=\"14\" rx=\"2.5\" fill=\"url(#pw-screen)\" stroke=\"#b85c3e\" stroke-width=\"1\"/>" +
    "<path d=\"M5 6.5 L10 6.5\" stroke=\"#fff\" stroke-opacity=\".7\" stroke-width=\"1.4\" stroke-linecap=\"round\"/>" +
    "<path d=\"M9 21h6M12 17v4\" stroke=\"#9aa4b2\" stroke-width=\"2\" stroke-linecap=\"round\"/>" +
  "</svg>";
const CLI_ICON =
  "<svg class=\"target-icon\" viewBox=\"0 0 24 24\" width=\"16\" height=\"16\" aria-hidden=\"true\">" +
    "<rect x=\"2\" y=\"3.5\" width=\"20\" height=\"17\" rx=\"2.5\" fill=\"#0d1117\" stroke=\"#e6edf3\" stroke-width=\"1.2\"/>" +
    "<path d=\"M6 9l3.5 3L6 15\" fill=\"none\" stroke=\"#e6edf3\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>" +
    "<path d=\"M12 15.5h6\" stroke=\"#e6edf3\" stroke-width=\"1.8\" stroke-linecap=\"round\"/>" +
  "</svg>";

function getClaudeTarget() { return claudeTarget || detectedTarget || "desktop"; }
async function setClaudeTarget(t) {
  claudeTarget = t;
  updateClaudeTargetToggle();
  render();
  try {
    await fetch("/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ claudeTarget: t }),
    });
  } catch (err) { console.error("could not save Claude preference", err); }
}
function updateClaudeTargetToggle() {
  const el = document.getElementById("claude-target");
  if (!el) return;
  const t = getClaudeTarget();
  el.innerHTML = t === "cli" ? CLI_ICON + "<span>Claude: terminal</span>" : DESKTOP_ICON + "<span>Claude: desktop</span>";
  el.title = "Where the action chips on your-turn cards open Claude" +
    (claudeTarget ? " (your choice)" : " (best guess from what's installed)") +
    ". Click to switch. ⌥-click a chip to use the other one.";
}

// Small popover anchored under a chip. `onAction(button)` handles clicks on
// buttons carrying data-action; the popover closes afterwards.
function showPopover(anchor, html, onAction) {
  closePopover();
  const pop = document.createElement("div");
  pop.id = "claude-popover";
  pop.innerHTML = html;
  document.body.appendChild(pop);
  const r = anchor.getBoundingClientRect();
  pop.style.left = Math.max(8, Math.min(r.left, window.innerWidth - pop.offsetWidth - 8)) + "px";
  pop.style.top = (r.bottom + 6 + window.scrollY) + "px";
  pop.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-action]");
    if (!b) return;
    if (onAction(b) !== false) closePopover();
  });
}
function closePopover() {
  const el = document.getElementById("claude-popover");
  if (el) el.remove();
}

// Chip for a repo with no known local clone: explain, offer the fix, or open
// a terminal anyway (Claude Code may still resolve `repo=` from its own record).
function showUnmappedPopover(anchor) {
  const repo = anchor.dataset.repo;
  const cmd = "node " + (reposScript || "~/.claude/pr-watch/repos.mjs") + " --set " + repo + "=/path/to/clone";
  showPopover(anchor,
    "<div class=\"pop-title\">⚠ No local clone of " + escapeHtml(repo) + "</div>" +
    "<div class=\"pop-note\">Claude desktop needs the folder. Map it once (applies on the next poll):</div>" +
    "<code class=\"pop-code\">" + escapeHtml(cmd) + "</code>" +
    "<button type=\"button\" data-action=\"copy\">Copy command</button>" +
    "<button type=\"button\" data-action=\"cli\">" + CLI_ICON + "<span>Open in terminal anyway</span></button>" +
    "<div class=\"pop-note\">The terminal opens your most recent clone Claude Code knows of, or your home folder if none.</div>",
    (b) => {
      if (b.dataset.action === "copy") {
        navigator.clipboard.writeText(cmd).then(() => { b.textContent = "Copied ✓"; }, () => { b.textContent = "Copy failed — select the text"; });
        return false; // keep open
      }
      window.location.href = anchor.dataset.cli;
    });
}

const CLAUDE_ICON =
  "<svg viewBox=\"0 0 24 24\" width=\"14\" height=\"14\" aria-hidden=\"true\"><path fill=\"currentColor\" d=\"M12 2.5c.55 0 1 .45 1 1v5.1l3.6-3.6a1 1 0 1 1 1.4 1.4L14.4 10H19.5a1 1 0 1 1 0 2h-5.1l3.6 3.6a1 1 0 1 1-1.4 1.4L13 13.4v5.1a1 1 0 1 1-2 0v-5.1L7.4 17A1 1 0 1 1 6 15.6L9.6 12H4.5a1 1 0 1 1 0-2h5.1L6 6.4A1 1 0 1 1 7.4 5L11 8.6V3.5c0-.55.45-1 1-1z\"/></svg>";

let repoPaths = {};
let reposScript = null;

function claudeChip(pr, rev) {
  const local = (repoPaths[pr.repo] && repoPaths[pr.repo].path) || null;
  const links = claudeLinks(pr, local, GITHUB_USER);
  const target = getClaudeTarget();
  // Desktop needs a local folder; without one, fall back to the CLI, which
  // resolves the repo itself from clones Claude Code has seen.
  const primary = target === "desktop" && links.desktop ? links.desktop : links.cli;
  const alt = primary === links.cli ? links.desktop : links.cli;
  const where = primary === links.desktop ? "Claude desktop" : "a terminal";
  const title = rev.status + "\n" + (!local ? "No local clone of " + pr.repo + " — click for how to fix"
    : "Open in " + where + " (" + local + ")") +
    "\n" + claudePrompt(pr, GITHUB_USER) +
    (alt ? " · ⌥-click for " + (alt === links.desktop ? "desktop" : "terminal") : "");
  return "<a class=\"chip chip-cta claude-open " + rev.cls + (local ? "" : " unmapped") + "\" href=\"" + escapeHtml(primary) + "\"" +
    (alt ? " data-alt=\"" + escapeHtml(alt) + "\"" : "") +
    " data-cli=\"" + escapeHtml(links.cli) + "\" data-repo=\"" + escapeHtml(pr.repo) + "\"" +
    (links.desktop ? " data-desktop=\"" + escapeHtml(links.desktop) + "\"" : "") +
    " title=\"" + escapeHtml(title) + "\">" + rev.text + "<span class=\"claude-logo\">" + CLAUDE_ICON + "</span></a>";
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
  if (payload.pollerVersion) updateVersionLink(payload.pollerVersion);
  repoPaths = payload.repoPaths || {};
  if (payload.reposScript) reposScript = payload.reposScript;
  if (payload.claudeTargets) detectedTarget = payload.claudeTargets.guess || null;
  if (payload.config) claudeTarget = payload.config.claudeTarget || null;
  updateClaudeTargetToggle();
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
  document.title = bic.length > 0 ? "(" + bic.length + ") PR Watch" : "PR Watch";

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
        (repoPaths[repo] && !repoPaths[repo].path
          ? "<span class=\"unmapped-warn\" title=\"No local clone known for " + escapeHtml(repo) + " — Claude chips open a terminal. Map it with repos.mjs --set " + escapeHtml(repo) + "=/path\">⚠</span>"
          : "") +
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
    const rev = ctaChip(pr, GITHUB_USER);
    const bounces = bouncesCount(pr);
    const bouncesChip = bounces > 0 ? "<span class=\"chip\" title=\"" + bounces + " 'request changes' review" + (bounces === 1 ? "" : "s") + " — this PR has bounced back to the author " + bounces + " time" + (bounces === 1 ? "" : "s") + "\">🏓 " + bounces + "</span>" : "";
    // Layout: CTA on the left (the primary signal), everything else
    // right-aligned in a meta cluster (secondary state + age).
    chips = "<div class=\"top-card-footer\">" +
      claudeChip(pr, rev) +
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
        // Left column: avatar + number, Linear key underneath, so the title
        // gets the rest of the width.
        "<div class=\"card-meta\">" +
          "<div class=\"card-meta-row\">" + avatar +
            "<span class=\"num\"><a href=\"" + escapeHtml(pr.url) + "\" target=\"_blank\" rel=\"noopener\">#" + pr.number + "</a></span>" +
          "</div>" +
          linearHtml +
        "</div>" +
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

document.addEventListener("click", (e) => {
  if (e.target.closest("#claude-popover")) return;
  const a = e.target.closest("a.claude-open");
  if (a && a.classList.contains("unmapped")) {
    e.preventDefault();
    showUnmappedPopover(a);
    return;
  }
  closePopover();
  if (a && e.altKey && a.dataset.alt) {
    e.preventDefault();
    window.location.href = a.dataset.alt;
    return;
  }
  if (e.target.closest("#claude-target")) {
    setClaudeTarget(getClaudeTarget() === "cli" ? "desktop" : "cli");
  }
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closePopover(); });
updateClaudeTargetToggle();

const es = new EventSource("/stream");
es.addEventListener("message", (e) => {
  try { applyPayload(JSON.parse(e.data)); }
  catch (err) { console.error("bad payload", err); }
});
