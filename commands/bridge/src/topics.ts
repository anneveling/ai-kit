// Items + decisions → topics. Pure.
//
// Default: one topic per Linear story (story:BG-1636). My decisions merge
// topics up, move or split items, close, snooze, mark seen and rename.
// Items without a story and without a decision go to New.

import { BALL_STATES } from "./types.ts";
import type { Ball, Config, Decision, Event, Item, ReopenRule, Topic } from "./types.ts";

export interface TopicsInput {
  items: Item[];
  events: Event[];
  decisions: Decision[];
  config: Config;
  now: Date;
}

export interface TopicsResult {
  topics: Topic[];
  /** Items with dismissals applied. */
  items: Item[];
  /** Ids of items in no topic. */
  newItems: string[];
}

interface Replayed {
  alias: Map<string, string>;
  made: Map<string, string>;
  placed: Map<string, string>;
  closed: Map<string, { at: string; reopen: ReopenRule }>;
  snoozed: Map<string, string>;
  seen: Map<string, string>;
  names: Map<string, string>;
  colours: Map<string, string>;
  areas: Map<string, string>;
  dismissed: Map<string, string>;
}

function replay(decisions: Decision[]): Replayed {
  const r: Replayed = {
    alias: new Map(), made: new Map(), placed: new Map(), closed: new Map(), snoozed: new Map(),
    seen: new Map(), names: new Map(), colours: new Map(), areas: new Map(), dismissed: new Map(),
  };
  for (const d of decisions) {
    switch (d.kind) {
      case "merge": if (d.from !== d.into) r.alias.set(d.from, d.into); break;
      case "new_topic": r.made.set(d.id, d.name); break;
      case "move": r.placed.set(d.item, d.to); break;
      case "split": r.made.set(d.id, d.name); r.placed.set(d.item, d.id); break;
      case "close": r.closed.set(d.topic, { at: d.at, reopen: d.reopen }); break;
      case "reopen": r.closed.delete(d.topic); break;
      case "snooze": r.snoozed.set(d.topic, d.until); break;
      case "seen": if (!(r.seen.get(d.topic)! >= d.upTo)) r.seen.set(d.topic, d.upTo); break;
      case "name": r.names.set(d.topic, d.name); break;
      case "colour": r.colours.set(d.topic, d.colour); break;
      case "area": r.areas.set(d.topic, d.area); break;
      case "dismiss_action": r.dismissed.set(d.item, d.at); break;
    }
  }
  return r;
}

/** Follow merges to the topic that holds it now. Cycles stop where they loop. */
function resolver(alias: Map<string, string>) {
  return (id: string): string => {
    const seen = new Set<string>();
    let cur = id;
    while (alias.has(cur) && !seen.has(cur)) {
      seen.add(cur);
      cur = alias.get(cur)!;
    }
    return cur;
  };
}

function applyDismissal(item: Item, dismissedAt: string | undefined): Item {
  if (!dismissedAt || !item.assessment.next || item.assessment.since > dismissedAt) return item;
  const { next: _dropped, stuck: _stuck, ...rest } = item.assessment;
  return { ...item, assessment: { ...rest, state: "quiet" } };
}

function colourFor(id: string, palette: string[]): string {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return palette[h % palette.length] ?? "#64748b";
}

function mostCommon(values: string[]): string | undefined {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: string | undefined;
  let bestN = 0;
  for (const [v, n] of counts) if (n > bestN) { best = v; bestN = n; }
  return best;
}

const sortedBall = (balls: Ball[]): Ball => [...new Set(balls.flat())].sort();

export function buildTopics({ items: rawItems, events, decisions, config, now }: TopicsInput): TopicsResult {
  const r = replay(decisions);
  const resolve = resolver(r.alias);
  const items = rawItems.map((i) => applyDismissal(i, r.dismissed.get(i.id)));

  const members = new Map<string, Item[]>();
  const newItems: string[] = [];
  for (const it of items) {
    const home = r.placed.get(it.id) ?? (it.storyKey ? `story:${it.storyKey}` : undefined);
    if (!home) { newItems.push(it.id); continue; }
    const id = resolve(home);
    if (!members.has(id)) members.set(id, []);
    members.get(id)!.push(it);
  }
  // Topics I made stay, even empty, unless merged away.
  for (const id of r.made.keys()) if (resolve(id) === id && !members.has(id)) members.set(id, []);

  const lastEventAt = new Map<string, string>();
  for (const e of events) if (!(lastEventAt.get(e.itemId)! >= e.at)) lastEventAt.set(e.itemId, e.at);

  const topics: Topic[] = [];
  for (const [id, its] of members) {
    // The most urgent state wins; within it, the item waiting longest decides.
    const state = BALL_STATES.find((s) => its.some((i) => i.assessment.state === s)) ?? "quiet";
    const deciding = its
      .filter((i) => i.assessment.state === state)
      .sort((a, b) => a.assessment.since.localeCompare(b.assessment.since));
    const lead = deciding[0];
    const story = its.find((i) => i.kind === "story" && `story:${i.storyKey}` === id);

    const topic: Topic = {
      id,
      name: r.names.get(id) ?? r.made.get(id) ?? story?.title ?? fallbackName(id, its),
      colour: r.colours.get(id) ?? colourFor(id, config.colours),
      area: r.areas.get(id) ?? mostCommon(its.flatMap((i) => (i.area ? [i.area] : []))) ?? config.areas[0]!,
      itemIds: its.map((i) => i.id),
      state,
      ball: sortedBall(deciding.map((i) => i.assessment.ball)),
      since: lead?.assessment.since ?? "",
      line: lead?.assessment.line ?? "Nothing here yet",
      yourMoveCount: its.filter((i) => i.assessment.state === "your_move").length,
    };

    const closed = r.closed.get(id);
    if (closed && !reopens(closed, its, lastEventAt)) topic.closed = closed;
    const until = r.snoozed.get(id);
    if (until && Date.parse(until) > now.getTime()) topic.snoozedUntil = until;
    const seen = r.seen.get(id);
    if (seen) topic.seenUpTo = seen;
    topics.push(topic);
  }

  return { topics, items, newItems };
}

function reopens(
  closed: { at: string; reopen: ReopenRule },
  its: Item[],
  lastEventAt: Map<string, string>,
): boolean {
  switch (closed.reopen) {
    case "never": return false;
    case "ball_to_me":
      return its.some((i) => i.assessment.state === "your_move" && i.assessment.since > closed.at);
    case "any_activity":
      return its.some((i) => (lastEventAt.get(i.id) ?? "") > closed.at);
  }
}

/** Without the Linear story, a story topic is named after its oldest PR's title, minus the key. */
function fallbackName(id: string, its: Item[]): string {
  const key = id.replace(/^story:/, "");
  const pr = its.filter((i) => i.kind === "pr").sort((a, b) => a.id.localeCompare(b.id))[0];
  if (!pr) return key;
  const title = pr.title
    .replace(/^#\d+\s+/, "")
    .replace(new RegExp(`^\\w*\\(?${key}\\)?:?\\s*`, "i"), "")
    .replace(new RegExp(`\\[?${key}\\]?`, "i"), "")
    .trim();
  return title ? `${key} ${title}` : key;
}
