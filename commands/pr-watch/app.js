// Set from the `viewer` field of the first payload — see applyPayload.
let GITHUB_USER = null;

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]
  ));
}
function isBIC(pr) {
  if ((pr.reviewRequests || []).includes(GITHUB_USER)) return true;
  if (pr.role === "reviewer") {
    const my = latestMyReview(pr);
    // If you've already left a final review, it's no longer your ball unless re-requested.
    if (my && (my.state === "APPROVED" || my.state === "CHANGES_REQUESTED")) return false;
    // Mid-review (no review yet, or only COMMENTED) — still your ball, even if others
    // have already approved/requested changes.
    return true;
  }
  // As author, changes were requested and you haven't handed it back yet — your turn.
  if (pr.role === "author" && pr.reviewDecision === "CHANGES_REQUESTED" && !authorHandedBack(pr)) {
    return true;
  }
  // As author, PR is approved and ready for you to merge.
  if (pr.role === "author" && pr.reviewDecision === "APPROVED" && !pr.isDraft) {
    return true;
  }
  return false;
}
function extractLinear(title) {
  const m = String(title || "").match(/[A-Z]{2,}-\d+/);
  return m ? m[0] : null;
}
function ageStr(ts) {
  const ms = Date.now() - new Date(ts).getTime();
  const m = ms / 60000;
  const h = m / 60;
  const d = h / 24;
  if (d >= 1) return Math.floor(d) + "d";
  if (h >= 1) return Math.floor(h) + "h";
  if (m >= 1) return Math.floor(m) + "m";
  return "now";
}
function ageWarn(ts) {
  const d = (Date.now() - new Date(ts).getTime()) / 86400000;
  if (d > 3) return "🚨";
  if (d > 1) return "⚠️";
  return "";
}
function ciChip(pr) {
  switch (pr.ciStatus) {
    case "SUCCESS": return { cls: "green", text: "✅ CI" };
    case "FAILURE": return { cls: "red", text: "❌ CI" };
    case "PENDING": return { cls: "yellow", text: "⏳ CI" };
    default: return null;
  }
}
function latestMyReview(pr) {
  const mine = (pr.reviews || [])
    .filter((r) => r.author && r.author.login === GITHUB_USER)
    .sort((a, b) => new Date(b.submittedAt || 0) - new Date(a.submittedAt || 0));
  return mine[0] || null;
}
function myReviewCount(pr) {
  return (pr.reviews || []).filter((r) => r.author && r.author.login === GITHUB_USER).length;
}
function hasRespondedAfterChanges(pr) {
  const latestChanges = (pr.reviews || [])
    .filter((r) => r.state === "CHANGES_REQUESTED" && r.author && r.author.login !== GITHUB_USER)
    .sort((a, b) => new Date(b.submittedAt || 0) - new Date(a.submittedAt || 0))[0];
  if (!latestChanges) return false;
  return (pr.reviews || []).some((r) =>
    r.author && r.author.login === GITHUB_USER &&
    new Date(r.submittedAt || 0) > new Date(latestChanges.submittedAt || 0));
}
// Author signal: have you handed the PR back since the last CHANGES_REQUESTED?
// Authors can't review their own PR, so the strongest signal is a pending
// re-request: reviewRequests becomes non-empty again after the author pushes.
function authorHandedBack(pr) {
  if ((pr.reviewRequests || []).length > 0) return true;
  return hasRespondedAfterChanges(pr);
}
function reviewChip(pr) {
  if (pr.role === "author") {
    if (pr.reviewDecision === "CHANGES_REQUESTED") {
      return authorHandedBack(pr)
        ? { cls: "yellow", text: "🟡 Re-review" }
        : { cls: "review-changes", text: "🟠 Fix requested" };
    }
    if (pr.reviewDecision === "APPROVED") return { cls: "green", text: "🟢 Approved" };
    if ((pr.reviewRequests || []).length > 0) return { cls: "yellow", text: "🟡 In review" };
    return { cls: "", text: "⚪ Waiting review" };
  }
  if ((pr.reviewRequests || []).includes(GITHUB_USER)) return { cls: "yellow", text: "🟡 Your review" };
  const my = latestMyReview(pr);
  if (my && my.state === "CHANGES_REQUESTED") return { cls: "review-changes", text: "🟠 Changes asked" };
  if (my && my.state === "APPROVED") return { cls: "", text: "⚪ Author to merge" };
  if (my && my.state === "COMMENTED") return { cls: "", text: "⚪ Waiting others" };
  if (pr.reviewDecision === "CHANGES_REQUESTED") return { cls: "", text: "⚪ Author fixing" };
  if (pr.reviewDecision === "APPROVED") return { cls: "green", text: "🟢 Approved" };
  return { cls: "yellow", text: "🟡 Awaiting you" };
}
function priorityChip(pr) {
  const ci = ciChip(pr);
  if (ci && ci.cls === "red") return ci;
  const rev = reviewChip(pr);
  if (rev && rev.cls) return rev;
  const w = ageWarn(pr._searchUpdatedAt);
  if (w) return { cls: "urgent", text: w + " " + ageStr(pr._searchUpdatedAt) };
  return rev || { cls: "", text: ageStr(pr._searchUpdatedAt) };
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
      p._searchUpdatedAt !== pr._searchUpdatedAt
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

  let chips = "";
  if (lane === "top") {
    const ci = ciChip(pr);
    const rev = reviewChip(pr);
    const w = ageWarn(pr._searchUpdatedAt);
    const myCount = myReviewCount(pr);
    const reviewCountChip = myCount > 0 ? "<span class=\"chip\">📝 " + myCount + " review" + (myCount === 1 ? "" : "s") + "</span>" : "";
    chips = "<div class=\"top-card-footer\">" +
      (ci ? "<span class=\"chip " + ci.cls + "\">" + ci.text + "</span>" : "") +
      "<span class=\"chip " + rev.cls + "\">" + rev.text + "</span>" +
      "<span class=\"chip\">" + (w ? w + " " : "") + ageStr(pr._searchUpdatedAt) + "</span>" +
      reviewCountChip +
    "</div>";
  } else {
    const p = priorityChip(pr);
    chips = "<div class=\"chips\"><span class=\"chip " + p.cls + "\">" + p.text + "</span></div>";
  }
  if (lane === "top") {
    return "<div class=\"pr role-" + pr.role + (pr.isDraft ? " draft" : "") + "\" style=\"border-left-color:" + repoColorValue + "\">" +
      "<div class=\"top-card-header\">" +
        delta +
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
