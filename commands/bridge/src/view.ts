// What the two pages show, as plain JSON. Pure: everything comes in through World.

import { briefing } from "./briefing.ts";
import { helmLink } from "./repos.ts";
import { buildTopics } from "./topics.ts";
import { pickHot, withAlerts } from "./urgency.ts";
import { BALL_STATES } from "./types.ts";
import type { BallHolder, Config, Decision, Event, Item, ItemKind, ItemTone, Person, SourceHealth, SourceName, Topic } from "./types.ts";

export interface World {
  items: Item[];
  events: Event[];
  people: Person[];
  decisions: Decision[];
  config: Config;
  now: Date;
  health: SourceHealth[];
  /** Things the header must say, e.g. skipped lines in decisions.jsonl. */
  problems: string[];
  /** owner/name → local clone, for Take the helm. */
  repoPaths?: Record<string, string | null>;
}

export interface Computed { topics: Topic[]; items: Item[]; newItems: string[] }

export function compute(w: World): Computed {
  const r = buildTopics({ items: w.items, events: w.events, decisions: w.decisions, config: w.config, now: w.now });
  return { topics: withAlerts(r.topics, r.items, w.config, w.now), items: r.items, newItems: r.newItems };
}

export function nameOf(who: BallHolder, people: Person[]): string {
  if (who === "me") return "You";
  if (who === "ci") return "CI";
  if (who === "officer") return "The officer";
  return people.find((p) => p.id === who)?.name ?? who;
}

export function ballText(t: Topic, people: Person[]): string {
  switch (t.state) {
    case "your_move": return t.alert === "red" ? "Your move" : "Your move, soon";
    case "in_motion": return "In motion";
    case "waiting": {
      const others = t.ball.filter((b) => b !== "me").map((b) => nameOf(b, people));
      return others.length ? `Waiting on ${others.join(", ")}` : "Waiting";
    }
    case "quiet": return "Quiet";
  }
}

function row(t: Topic, people: Person[]) {
  return {
    id: t.id, name: t.name, colour: t.colour, area: t.area, state: t.state, alert: t.alert ?? null,
    ball: ballText(t, people), line: t.line, since: t.since, snoozedUntil: t.snoozedUntil ?? null,
  };
}
export type TopicRow = ReturnType<typeof row>;

const STATE_RANK = new Map(BALL_STATES.map((s, i) => [s, i]));

export function bridgeView(w: World) {
  const { topics, items, newItems } = compute(w);
  const byItem = new Map(items.map((i) => [i.id, i]));
  // Everything merged or done and nobody needs to act: fold it away.
  const isDone = (t: Topic) => t.state === "quiet" && t.itemIds.length > 0 && t.itemIds.every((id) => byItem.get(id)?.status.tone === "done");
  const done = topics.filter((t) => !t.closed && isDone(t));
  const open = topics.filter((t) => !t.closed && !isDone(t));
  const { hot, split } = pickHot(open);
  const hotIds = new Set(hot.map((t) => t.id));
  const rest = open
    .filter((t) => !hotIds.has(t.id))
    .sort((a, b) => {
      const snoozed = Number(Boolean(a.snoozedUntil)) - Number(Boolean(b.snoozedUntil));
      return snoozed || STATE_RANK.get(a.state)! - STATE_RANK.get(b.state)! || a.since.localeCompare(b.since);
    });
  const areas = [...w.config.areas, ...new Set(open.map((t) => t.area).filter((a) => !w.config.areas.includes(a)))];
  const groups = areas
    .map((area) => ({ area, topics: rest.filter((t) => t.area === area).map((t) => row(t, w.people)) }))
    .filter((g) => g.topics.length > 0);
  const anyAlert = open.some((t) => t.alert);

  return {
    now: w.now.toISOString(),
    health: w.health,
    problems: w.problems,
    hot: hot.map((t) => row(t, w.people)),
    hotSplit: split,
    /** Sides of a split hot block keep this order, so work and life stay put. */
    areas,
    newItems: newItems
      .flatMap((id) => byItem.get(id) ?? [])
      .filter((i) => i.status.tone !== "done")
      .sort((a, b) => STATE_RANK.get(a.assessment.state)! - STATE_RANK.get(b.assessment.state)! || a.assessment.since.localeCompare(b.assessment.since))
      .map((i) => ({
        id: i.id, source: i.source, title: i.title, where: i.where ?? null, line: i.assessment.line,
        since: i.assessment.since, url: i.url ?? null, state: i.assessment.state,
      })),
    /** True until every source has answered once: never show "all quiet" before we know. */
    loading: w.health.some((h) => !h.ok && !h.lastOk && h.message === "starting…"),
    groups,
    quiet: anyAlert ? null : {
      inMotion: open.filter((t) => t.state === "in_motion").length,
      waiting: open.filter((t) => t.state === "waiting").length,
    },
    /** Topics where everything is done, in the 14-day window. */
    doneCount: done.length,
    openTopics: openTopicList(open),
  };
}
export type BridgeView = ReturnType<typeof bridgeView>;

function openTopicList(open: Topic[]) {
  return open.map((t) => ({ id: t.id, name: t.name, colour: t.colour })).sort((a, b) => a.name.localeCompare(b.name));
}

const SOURCE_ORDER: SourceName[] = ["linear", "github", "slack", "notion", "officer"];
const SOURCE_LABEL: Record<SourceName, string> = { linear: "Linear", github: "GitHub", slack: "Slack", notion: "GTD", officer: "Officer" };
const NOUN: Record<ItemKind, [string, string]> = {
  story: ["story", "stories"], pr: ["PR", "PRs"], thread: ["thread", "threads"], task: ["task", "tasks"], job: ["job", "jobs"],
};
const TONES: ItemTone[] = ["done", "active", "attention", "idle"];

export function topicView(w: World, id: string) {
  const { topics, items } = compute(w);
  const t = topics.find((x) => x.id === id);
  if (!t) return undefined;
  const mine = new Set(t.itemIds);
  const its = items.filter((i) => mine.has(i.id));
  const byItem = new Map(its.map((i) => [i.id, i]));

  const log = w.events
    .filter((e) => mine.has(e.itemId))
    .sort((a, b) => b.at.localeCompare(a.at))
    .map((e) => ({
      id: e.id, at: e.at, source: e.source, who: nameOf(e.who, w.people), text: e.text, tone: e.tone ?? null,
      mine: e.who === "me", routine: Boolean(e.routine), isNew: Boolean(t.seenUpTo ? e.at > t.seenUpTo : true),
      item: byItem.get(e.itemId)?.title ?? e.itemId,
    }));

  const next = its
    .filter((i) => i.assessment.next)
    .sort((a, b) => STATE_RANK.get(a.assessment.state)! - STATE_RANK.get(b.assessment.state)! || a.assessment.since.localeCompare(b.assessment.since))
    .map((i) => ({ itemId: i.id, state: i.assessment.state, since: i.assessment.since, ...i.assessment.next!, helmUrl: helmUrl(i, t.name, w.repoPaths) }));

  const sources = SOURCE_ORDER.flatMap((source) => {
    const group = its.filter((i) => i.source === source);
    if (group.length === 0) return [];
    const kind = group[0]!.kind;
    const [one, many] = NOUN[kind];
    const labelCounts = new Map<string, number>();
    for (const i of group) labelCounts.set(i.status.label, (labelCounts.get(i.status.label) ?? 0) + 1);
    return [{
      source,
      label: SOURCE_LABEL[source],
      noun: `${group.length} ${group.length === 1 ? one : many}`,
      summary: [...labelCounts].map(([label, n]) => `${n} ${label}`).join(" · "),
      bar: TONES.map((tone) => ({ tone, n: group.filter((i) => i.status.tone === tone).length })).filter((s) => s.n > 0),
      contexts: [...new Set(group.flatMap((i) => (i.context ? [i.context] : [])))],
      items: group.map((i) => ({
        id: i.id, title: i.title, where: i.where ?? null, url: i.url ?? null, status: i.status,
        state: i.assessment.state, line: i.assessment.line,
        needs: i.assessment.state === "your_move" || i.assessment.state === "waiting" || i.status.tone === "attention",
      })),
    }];
  });

  return {
    now: w.now.toISOString(),
    health: w.health,
    problems: w.problems,
    topic: {
      ...row(t, w.people),
      itemCount: t.itemIds.length, yourMoveCount: t.yourMoveCount, seenUpTo: t.seenUpTo ?? null,
      closed: t.closed ?? null,
    },
    briefing: briefing(its),
    log,
    next,
    sources,
    openTopics: openTopicList(topics.filter((x) => !x.closed && x.id !== id)),
    areas: w.config.areas,
    colours: w.config.colours,
  };
}
export type TopicView = NonNullable<ReturnType<typeof topicView>>;

/** Take the helm works for PRs now; other sources get it with the officer (phase 6). */
function helmUrl(i: Item, topic: string, repoPaths: Record<string, string | null> = {}): string | null {
  const m = /^github:(.+)#(\d+)$/.exec(i.id);
  if (!m || !i.assessment.next) return null;
  return helmLink(i.assessment.next.verb, m[1]!, Number(m[2]), topic, repoPaths[m[1]!] ?? null);
}
