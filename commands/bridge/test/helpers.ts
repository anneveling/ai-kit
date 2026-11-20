// Small builders for made-up items and events in tests.

import type { Assessment, Event, Item } from "../src/types.ts";

export const T0 = "2026-11-20T10:00:00.000Z";

export function item(id: string, over: Partial<Item> & { a?: Partial<Assessment> } = {}): Item {
  const { a, ...rest } = over;
  return {
    id,
    source: "github",
    kind: "pr",
    title: id,
    status: { label: "open", tone: "active" },
    assessment: { ball: [], state: "quiet", since: T0, line: `${id} is quiet`, ...a },
    ...rest,
  };
}

export function event(itemId: string, at: string, over: Partial<Event> = {}): Event {
  return { id: `${itemId}@${at}`, itemId, source: "github", at, who: "sam", text: "something", ...over };
}
