// Pure functions — no side effects, fully testable.

export function buildPayload(prs, viewer, { schemaVersion, pollerVersion }) {
  return {
    schemaVersion,
    pollerVersion,
    viewer,
    generatedAt: new Date().toISOString(),
    prs,
  };
}

export function ciSummary(checkRollup) {
  if (!checkRollup?.length) return null;
  const states = checkRollup.map((c) => c.status ?? c.conclusion ?? "PENDING");
  if (states.some((s) => ["FAILURE", "ERROR", "ACTION_REQUIRED"].includes(s))) return "FAILURE";
  if (states.some((s) => ["IN_PROGRESS", "QUEUED", "PENDING", "WAITING"].includes(s))) return "PENDING";
  if (states.every((s) => ["SUCCESS", "NEUTRAL", "SKIPPED", "COMPLETED"].includes(s))) return "SUCCESS";
  return "PENDING";
}

// Returns a changes object if anything changed, null if identical.
export function diffPr(prev, enriched) {
  const changes = {};

  if (prev.reviewDecision !== enriched.reviewDecision)
    changes.reviewDecision = { from: prev.reviewDecision, to: enriched.reviewDecision };
  if (prev.isDraft !== enriched.isDraft)
    changes.isDraft = { from: prev.isDraft, to: enriched.isDraft };
  if (prev.ciStatus !== enriched.ciStatus)
    changes.ciStatus = { from: prev.ciStatus, to: enriched.ciStatus };

  // GitHub computes mergeable/mergeStateStatus async — first poll after a push
  // often returns UNKNOWN, then settles. Ignore transitions involving UNKNOWN
  // so we don't fire spurious "changed" events during the flicker.
  const settled = (a, b) => a !== "UNKNOWN" && b !== "UNKNOWN" && a !== b;
  if (settled(prev.mergeable, enriched.mergeable))
    changes.mergeable = { from: prev.mergeable, to: enriched.mergeable };
  if (settled(prev.mergeStateStatus, enriched.mergeStateStatus))
    changes.mergeStateStatus = { from: prev.mergeStateStatus, to: enriched.mergeStateStatus };

  const prevReviewSig = JSON.stringify((prev.latestReviews     ?? []).map((r) => `${r.login}:${r.state}`).sort());
  const nextReviewSig = JSON.stringify((enriched.latestReviews ?? []).map((r) => `${r.login}:${r.state}`).sort());
  if (prevReviewSig !== nextReviewSig)
    changes.latestReviews = { from: prev.latestReviews, to: enriched.latestReviews };

  return Object.keys(changes).length > 0 ? changes : null;
}

// Pure event computation — no I/O. Takes pre-enriched PRs and returns { nextState, events }.
// Accepts isFirstRun so tests can exercise both startup and normal-poll behavior.
export function computeEvents(summaries, enrichedMap, prevState, isFirstRun, now = new Date()) {
  const ts = now.toISOString().slice(0, 19) + "Z";
  const events = [];
  const nextState = {};

  for (const { url } of summaries) {
    const enriched = enrichedMap[url];
    if (!enriched) continue;
    const prev = prevState[url];

    if (!isFirstRun) {
      if (!prev) {
        events.push({ event: "new", ts, repo: enriched.repo, pr: enriched.number,
          title: enriched.title, url, role: enriched.role,
          reviewDecision: enriched.reviewDecision, isDraft: enriched.isDraft,
          ciStatus: enriched.ciStatus });
      } else {
        const changes = diffPr(prev, enriched);
        if (changes) {
          events.push({ event: "changed", ts, repo: enriched.repo, pr: enriched.number,
            title: enriched.title, url, role: enriched.role,
            reviewDecision: enriched.reviewDecision, isDraft: enriched.isDraft,
            ciStatus: enriched.ciStatus, changes });
        }
      }
    }

    nextState[url] = { ...enriched, _searchUpdatedAt: enriched.updatedAt };
  }

  if (!isFirstRun && Object.keys(prevState).length > 0) {
    const currentUrls = new Set(summaries.map((p) => p.url));
    for (const [url, prev] of Object.entries(prevState)) {
      if (!currentUrls.has(url)) {
        events.push({ event: "closed", ts, repo: prev.repo, pr: prev.number,
          title: prev.title, url, role: prev.role });
      }
    }
  }

  return { nextState, events };
}

// ── Per-PR computations (used by the dashboard, exported for tests) ──────────

// Latest non-DISMISSED review by `me` on this PR, or null.
export function latestMyReview(pr, me) {
  const mine = (pr.reviews || [])
    .filter((r) => r.author && r.author.login === me && r.state !== "DISMISSED")
    .sort((a, b) => new Date(b.submittedAt || 0) - new Date(a.submittedAt || 0));
  return mine[0] || null;
}

// Returns a Set of GitHub logins who own the next action on this PR.
//   draft                                   → author
//   pending review request                  → that user
//   blocked (CHANGES_REQUESTED, not re-req) → author (must fix + re-request)
//   approved + no pending re-request        → author (merge it)
//   conflicts (mergeStateStatus=DIRTY)      → author
//   behind main + approved                  → author (rebase to land)
//   reviewer with no final verdict          → that reviewer (mid-review)
//   author with no engagement at all        → author (add reviewers)
export function ballInCourt(pr, me) {
  const balls = new Set();
  const authorLogin = pr.author && pr.author.login;
  if (!authorLogin) return balls;

  if (pr.isDraft) { balls.add(authorLogin); return balls; }

  const pendingReReq = new Set(pr.reviewRequests || []);
  for (const login of pendingReReq) balls.add(login);

  const blockersUnaddressed = (pr.latestReviews || [])
    .some((r) => r.state === "CHANGES_REQUESTED" && !pendingReReq.has(r.login));
  if (blockersUnaddressed) balls.add(authorLogin);

  if (pr.reviewDecision === "APPROVED" && pendingReReq.size === 0) {
    balls.add(authorLogin);
  }

  if (pr.mergeStateStatus === "DIRTY") balls.add(authorLogin);
  if (pr.mergeStateStatus === "BEHIND" && pr.reviewDecision === "APPROVED") {
    balls.add(authorLogin);
  }

  // Other reviewers mid-review (COMMENTED, no final verdict, not re-requested).
  for (const r of pr.latestReviews || []) {
    if (r.state === "COMMENTED" && !pendingReReq.has(r.login)) balls.add(r.login);
  }

  // `me` as a tracked reviewer with no final verdict yet.
  if (me && pr.role === "reviewer") {
    const my = latestMyReview(pr, me);
    if (!my || my.state === "COMMENTED" || my.state === "PENDING") balls.add(me);
  }

  if (
    (pr.reviewRequests || []).length === 0 &&
    (pr.latestReviews || []).length === 0 &&
    pr.reviewDecision !== "APPROVED"
  ) {
    balls.add(authorLogin);
  }

  return balls;
}

// "Since when has the ball been in `me`'s court", inferred from review and
// PR timestamps. Returns an ISO timestamp or null when we can't tell.
export function bicSince(pr, me) {
  const authorLogin = pr.author && pr.author.login;
  if (authorLogin === me) {
    if (pr.reviewDecision === "CHANGES_REQUESTED") {
      const pendingReReq = new Set(pr.reviewRequests || []);
      const blocker = (pr.latestReviews || [])
        .filter((r) => r.state === "CHANGES_REQUESTED" && !pendingReReq.has(r.login))
        .sort((a, b) => new Date(b.submittedAt || 0) - new Date(a.submittedAt || 0))[0];
      if (blocker && blocker.submittedAt) return blocker.submittedAt;
    }
    if (pr.reviewDecision === "APPROVED") {
      const approval = (pr.latestReviews || [])
        .filter((r) => r.state === "APPROVED")
        .sort((a, b) => new Date(b.submittedAt || 0) - new Date(a.submittedAt || 0))[0];
      if (approval && approval.submittedAt) return approval.submittedAt;
    }
    if ((pr.latestReviews || []).length === 0 && (pr.reviewRequests || []).length === 0) {
      return pr.createdAt || null;
    }
  } else if (pr.role === "reviewer") {
    const my = latestMyReview(pr, me);
    if (my && my.submittedAt) return my.submittedAt;
  }
  return null;
}

// Number of times a non-author non-bot has filed CHANGES_REQUESTED. Approximates
// "how many round-trips this PR has had."
export function bouncesCount(pr) {
  const authorLogin = pr.author && pr.author.login;
  return (pr.reviews || []).filter((r) =>
    r.state === "CHANGES_REQUESTED" &&
    r.author && r.author.login &&
    r.author.login !== authorLogin &&
    !r.author.is_bot
  ).length;
}

// Floor-rounded "Nd / Nh / Nm / now" relative to `nowMs`.
export function ageStr(ts, nowMs = Date.now()) {
  const ms = nowMs - new Date(ts).getTime();
  const m = ms / 60000;
  const h = m / 60;
  const d = h / 24;
  if (d >= 1) return Math.floor(d) + "d";
  if (h >= 1) return Math.floor(h) + "h";
  if (m >= 1) return Math.floor(m) + "m";
  return "now";
}

// Chicken-lifecycle age marker: 🥚 < 1h, 🐣 < 6h, 🐥 < 3d, 🐔 < 7d, 🍗 ≥ 7d.
export function ageMarker(ts, nowMs = Date.now()) {
  const ms = nowMs - new Date(ts).getTime();
  const h = ms / 3600000;
  const d = h / 24;
  if (h < 1) return { cls: "age-young",   text: "🥚 " + ageStr(ts, nowMs) };
  if (h < 6) return { cls: "age-aging",   text: "🐣 " + ageStr(ts, nowMs) };
  if (d < 3) return { cls: "age-stale",   text: "🐥 " + ageStr(ts, nowMs) };
  if (d < 7) return { cls: "age-stale",   text: "🐔 " + ageStr(ts, nowMs) };
  return        { cls: "age-ancient", text: "🍗 " + ageStr(ts, nowMs) };
}

// CI summary chip.
export function ciChip(pr) {
  switch (pr.ciStatus) {
    case "SUCCESS": return { cls: "green",  text: "✅ CI" };
    case "FAILURE": return { cls: "red",    text: "❌ CI" };
    case "PENDING": return { cls: "yellow", text: "⏳ CI" };
    default: return null;
  }
}

// Merge / sync state chip — uses GitHub's mergeStateStatus.
export function mergeChip(pr) {
  switch (pr.mergeStateStatus) {
    case "DIRTY":  return { cls: "red",    text: "🔴 Conflict" };
    case "BEHIND": return { cls: "yellow", text: "🟠 Behind" };
    case "CLEAN":
    case "UNSTABLE":
    case "BLOCKED":
    case "HAS_HOOKS":
      return { cls: "green", text: "🟢 Fresh" };
    default: return null;
  }
}

// CTA chip: review-state summary from `me`'s perspective. Symmetric labels
// across lanes — top says what's asked of you, bottom says what they're doing.
export function reviewChip(pr, me) {
  if (pr.role === "author") {
    if (pr.reviewDecision === "APPROVED") {
      return { cls: "green", text: "🟢 Ready to merge" };
    }
    if (pr.reviewDecision === "CHANGES_REQUESTED") {
      const pendingReReq = new Set(pr.reviewRequests || []);
      const blockersUnaddressed = (pr.latestReviews || [])
        .some((r) => r.state === "CHANGES_REQUESTED" && !pendingReReq.has(r.login));
      return blockersUnaddressed
        ? { cls: "review-changes", text: "🟠 Fix requested" }
        : { cls: "yellow", text: "🟡 Re-review pending" };
    }
    if ((pr.reviewRequests || []).length === 0 && (pr.latestReviews || []).length === 0) {
      return { cls: "", text: "⚪ Reviewers needed" };
    }
    return { cls: "yellow", text: "🟡 In review" };
  }
  // Reviewer perspective.
  const my = latestMyReview(pr, me);
  if ((pr.reviewRequests || []).includes(me)) {
    return my
      ? { cls: "yellow", text: "🟡 Re-review requested" }
      : { cls: "yellow", text: "🟡 Review requested" };
  }
  if (!my) return { cls: "yellow", text: "🟡 Review requested" };
  if (my.state === "CHANGES_REQUESTED") return { cls: "review-changes", text: "🟠 Author to fix" };
  if (my.state === "APPROVED") return { cls: "green", text: "🟢 Author to merge" };
  return { cls: "yellow", text: "🟡 Review in progress" };
}

// Bottom-lane priority pick: CI red preempts, otherwise the review chip.
export function priorityChip(pr, me) {
  const ci = ciChip(pr);
  if (ci && ci.cls === "red") return ci;
  return reviewChip(pr, me);
}

// Accepts env and now as parameters so it can be tested without mocking globals.
export function computeStopTime(env = process.env, now = new Date()) {
  if (env.HOURS) {
    return new Date(now.getTime() + parseFloat(env.HOURS) * 3600_000);
  }
  if (env.STOP_AT) {
    const [h, m] = env.STOP_AT.split(":").map(Number);
    const stopDate = new Date(now);
    stopDate.setHours(h, m, 0, 0);
    return stopDate;
  }
  const hour = now.getHours();
  if (hour >= 7 && hour < 18) {
    const stopDate = new Date(now);
    stopDate.setHours(18, 0, 0, 0);
    return stopDate;
  }
  return new Date(now.getTime() + 4 * 3600_000);
}
