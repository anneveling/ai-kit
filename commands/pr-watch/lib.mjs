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
