// Demo mode: made-up data from demo/demo.json, on a fixed clock so the pages
// (and screenshots) read the same every time. Times in the file are relative
// to "now": "-25m", "-3h", "-1d4h", "+2d".

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { App } from "./app.ts";
import { fixedClock } from "./clock.ts";
import { parseConfig } from "./config.ts";
import { Store } from "./store.ts";
import type { Decision, Event, Item, Person, SourceHealth } from "./types.ts";

export interface Demo {
  now: string;
  config: Record<string, unknown>;
  people: Person[];
  items: Item[];
  events: Event[];
  decisions: Decision[];
  health: SourceHealth[];
}

const REL = /^([+-])(?:(\d+)d)?(?:(\d+)h)?(?:(\d+)m)?$/;

export function resolveTimes<T>(value: T, now: Date): T {
  if (typeof value === "string") {
    const m = REL.exec(value);
    if (!m || value.length < 3) return value;
    const [, sign, d = "0", h = "0", min = "0"] = m;
    const ms = ((Number(d) * 24 + Number(h)) * 60 + Number(min)) * 60_000;
    return new Date(now.getTime() + (sign === "-" ? -ms : ms)).toISOString() as T;
  }
  if (Array.isArray(value)) return value.map((v) => resolveTimes(v, now)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolveTimes(v, now)])) as T;
  }
  return value;
}

export function loadDemo(path: string): Demo {
  const raw = JSON.parse(readFileSync(path, "utf8")) as Demo & { _about?: string };
  // "now" is local time without a zone, e.g. "2026-11-19T11:05".
  const now = new Date(raw.now);
  return { ...resolveTimes(raw, now), now: now.toISOString() };
}

export const DEMO_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "demo", "demo.json");

/** An App on the demo data. Decisions I make in the demo go to their own file. */
export function demoApp(decisionsPath: string): App {
  const demo = loadDemo(DEMO_PATH);
  const store = new Store();
  store.people = demo.people;
  for (const source of ["github", "linear", "slack", "notion"] as const) {
    store.put(source, { items: demo.items.filter((i) => i.source === source), events: demo.events.filter((e) => e.source === source) });
  }
  return new App({
    store, config: parseConfig(demo.config, "demo/demo.json", {}), clock: fixedClock(demo.now),
    decisionsPath, seedDecisions: demo.decisions, health: () => demo.health,
  });
}
