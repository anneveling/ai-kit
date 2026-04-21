// Pure functions — no side effects, fully testable.

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

  for (const { url, updatedAt } of summaries) {
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

    nextState[url] = { ...enriched, _searchUpdatedAt: updatedAt };
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
