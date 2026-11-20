// decisions.jsonl: append-only. Replayed on start. A bad line is skipped and
// reported, never rewritten, so nothing I decided gets lost silently.

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Decision } from "./types.ts";

export interface DecisionError { line: number; message: string }

const REOPEN = ["ball_to_me", "any_activity", "never"];

// Required string fields per kind.
const FIELDS: Record<Decision["kind"], string[]> = {
  merge: ["from", "into"],
  move: ["item", "to"],
  new_topic: ["id", "name"],
  split: ["item", "id", "name"],
  close: ["topic", "reopen"],
  reopen: ["topic"],
  snooze: ["topic", "until"],
  dismiss_action: ["item"],
  seen: ["topic", "upTo"],
  area: ["topic", "area"],
  name: ["topic", "name"],
  colour: ["topic", "colour"],
};

/** Returns an error message, or undefined when the decision is valid. */
export function validateDecision(raw: unknown): string | undefined {
  if (typeof raw !== "object" || raw === null) return "not an object";
  const d = raw as Record<string, unknown>;
  const kind = d.kind as Decision["kind"];
  const fields = FIELDS[kind];
  if (!fields) return `unknown kind "${String(d.kind)}"`;
  if (typeof d.at !== "string" || Number.isNaN(Date.parse(d.at))) return `${kind}: "at" must be an ISO time`;
  for (const f of fields) {
    if (typeof d[f] !== "string" || d[f] === "") return `${kind}: "${f}" is missing`;
  }
  if (kind === "close" && !REOPEN.includes(d.reopen as string)) return `close: reopen must be one of ${REOPEN.join(", ")}`;
  return undefined;
}

export function readDecisions(path: string): { decisions: Decision[]; errors: DecisionError[] } {
  const decisions: Decision[] = [];
  const errors: DecisionError[] = [];
  if (!existsSync(path)) return { decisions, errors };
  const lines = readFileSync(path, "utf8").split("\n");
  lines.forEach((text, i) => {
    if (text.trim() === "") return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      errors.push({ line: i + 1, message: "not valid JSON" });
      return;
    }
    const problem = validateDecision(parsed);
    if (problem) errors.push({ line: i + 1, message: problem });
    else decisions.push(parsed as Decision);
  });
  return { decisions, errors };
}

export function appendDecision(path: string, decision: Decision): void {
  const problem = validateDecision(decision);
  if (problem) throw new Error(`refusing to write a bad decision: ${problem}`);
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, JSON.stringify(decision) + "\n");
}
