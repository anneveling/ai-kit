// Red / yellow per topic, and the hot topics for the bridge. Pure.
//
// Red alert: my move AND something is stuck on me (see StuckKind).
// Yellow: any other my move. Snoozed and closed topics get no alert.
// Hot: at most three topics, red first, then the longest waiting.

import { HOUR, workingMsBetween } from "./clock.ts";
import type { Alert, Config, Item, Topic } from "./types.ts";

const QUESTION_RED_AFTER = 2 * HOUR;
export const MAX_HOT = 3;

function stuckNow(item: Item, config: Config, now: Date): boolean {
  const a = item.assessment;
  if (a.state !== "your_move") return false;
  switch (a.stuck) {
    case "question": return workingMsBetween(new Date(a.since), now, config.workingHours) >= QUESTION_RED_AFTER;
    case "ci_red_approved":
    case "overdue": return true;
    default: return false; // officer_question is decided per topic below
  }
}

export function withAlerts(topics: Topic[], items: Item[], config: Config, now: Date): Topic[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  return topics.map((t) => {
    const { alert: _old, ...rest } = t;
    if (t.closed || t.snoozedUntil || t.state !== "your_move") return rest;
    const its = t.itemIds.flatMap((id) => byId.get(id) ?? []);
    // An officer question only adds to a topic that's already red, so it never makes one red by itself.
    const alert: Alert = its.some((i) => stuckNow(i, config, now)) ? "red" : "yellow";
    return { ...rest, alert };
  });
}

export function pickHot(topics: Topic[]): { hot: Topic[]; split: boolean } {
  const hot = topics
    .filter((t) => t.alert)
    .sort((a, b) => {
      if (a.alert !== b.alert) return a.alert === "red" ? -1 : 1;
      return a.since.localeCompare(b.since);
    })
    .slice(0, MAX_HOT);
  return { hot, split: new Set(hot.map((t) => t.area)).size > 1 };
}
