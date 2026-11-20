// Time helpers. Pure: callers pass "now" in.

import type { WorkingHours } from "./types.ts";

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;

/** Milliseconds between a and b that fall within working hours (local time). */
export function workingMsBetween(a: Date, b: Date, hours: WorkingHours): number {
  if (b <= a) return 0;
  let total = 0;
  const day = new Date(a.getFullYear(), a.getMonth(), a.getDate());
  while (day < b) {
    if (hours.days.includes(day.getDay())) {
      const open = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hours.start);
      const close = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hours.end);
      const from = Math.max(a.getTime(), open.getTime());
      const to = Math.min(b.getTime(), close.getTime());
      if (to > from) total += to - from;
    }
    day.setDate(day.getDate() + 1);
  }
  return total;
}

/** A clock that can be fixed, for the demo and tests. */
export interface Clock { now(): Date }
export const systemClock: Clock = { now: () => new Date() };
export const fixedClock = (iso: string): Clock => ({ now: () => new Date(iso) });
