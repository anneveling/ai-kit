// Topic → a few plain sentences. First version: built from the items' own
// lines, most urgent first. Phase 5 makes it read better and rolls up the log.

import type { Item } from "./types.ts";

export function briefing(items: Item[]): string[] {
  const lines = (state: Item["assessment"]["state"]) =>
    items.filter((i) => i.assessment.state === state).map((i) => i.assessment.line);
  const out: string[] = [];
  const mine = lines("your_move");
  const moving = lines("in_motion");
  const waiting = lines("waiting");
  if (mine.length) out.push(`Your move: ${join(mine)}.`);
  if (moving.length) out.push(`In motion: ${join(moving)}.`);
  if (waiting.length) out.push(`Waiting: ${join(waiting)}.`);
  if (out.length === 0) out.push("Nothing needs anyone right now.");
  return out;
}

// Lines start with names and refs ("Sam asks…", "#812…"), so their case is kept.
function join(parts: string[]): string {
  return parts.length <= 1 ? (parts[0] ?? "") : `${parts.slice(0, -1).join("; ")}; and ${parts.at(-1)}`;
}
