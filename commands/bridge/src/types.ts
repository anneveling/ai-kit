// The words from the spec ("Words" table), as types. Erasable syntax only:
// unions of string literals instead of enums.

export type SourceName = "github" | "linear" | "slack" | "notion" | "officer";

/** "me" is always the user. Other ids come from config.json people. */
export type PersonId = string;

/** Who must act next. CI and the officer can hold the ball too. */
export type BallHolder = PersonId | "ci" | "officer";

/** A set, stored as a sorted array without duplicates. Empty means nobody. */
export type Ball = BallHolder[];

/** Ordered: the first is the most urgent. A topic takes the most urgent of its items. */
export type BallState = "your_move" | "in_motion" | "waiting" | "quiet";
export const BALL_STATES: readonly BallState[] = ["your_move", "in_motion", "waiting", "quiet"];

export type Verb =
  | "reply" | "review" | "fix" | "address" | "merge" | "nudge"
  | "do" | "answer" | "approve";

/** Why something counts as stuck on me; urgency.ts turns this into red or not. */
export type StuckKind =
  | "question"          // a question to me: red after 2h within working hours
  | "ci_red_approved"   // CI red on an approved PR: red at once
  | "overdue"           // a GTD task past its date: red at once
  | "officer_question"; // red only when the topic is already red

export interface NextAction {
  verb: Verb;
  /** "Fix CI on #812" */
  label: string;
  reason?: string;
  /** Sub-line for Make it so, e.g. "Claude fixes it". Absent: the officer can't do this one. */
  officer?: string;
  /** Sub-line for Take the helm, e.g. "you fix it". */
  helm?: string;
}

/** What the rules say about one item. */
export interface Assessment {
  ball: Ball;
  state: BallState;
  /** ISO time the ball last moved. */
  since: string;
  /** One line of what's happening, for the bridge and the topic page. */
  line: string;
  next?: NextAction;
  stuck?: StuckKind;
}

export type ItemKind = "pr" | "story" | "thread" | "task" | "job";

/** Where an item stands in its own source, for the count bar on the topic page. */
export type ItemTone = "done" | "active" | "attention" | "idle";

export interface Item {
  /** Source-native ref: github:org/repo#412, linear:BG-1234, slack:C0123/1700000000.000100, notion:<page>, job:<uuid> */
  id: string;
  source: SourceName;
  kind: ItemKind;
  title: string;
  url?: string;
  /** The Linear story this item belongs to, e.g. "BG-1636". Gives the default topic. */
  storyKey?: string;
  /** Mapped from repo / channel / team / GTD area in config. */
  area?: string;
  /** Short place label: repo, channel, project. */
  where?: string;
  /** Short status in its source: "merged", "CI ✗", "In review". */
  status: { label: string; tone: ItemTone };
  /** Extra context line, e.g. Linear project · milestone · progress. */
  context?: string;
  assessment: Assessment;
}

export interface Event {
  id: string;
  itemId: string;
  source: SourceName;
  /** ISO time. */
  at: string;
  who: BallHolder;
  text: string;
  /** Routine events roll up in the log ("3 PRs merged"). */
  routine?: boolean;
  tone?: "bad" | "good";
}

export interface Person {
  id: PersonId;
  name: string;
  slack?: string;
  github?: string;
  linear?: string;
  email?: string;
}

export type ReopenRule = "ball_to_me" | "any_activity" | "never";

export type Alert = "red" | "yellow";

export interface Topic {
  /** story:BG-1636 for automatic topics; a short slug for topics I made. */
  id: string;
  name: string;
  colour: string;
  area: string;
  itemIds: string[];
  state: BallState;
  ball: Ball;
  /** ISO; when the deciding item's ball last moved. Empty for a topic without items. */
  since: string;
  line: string;
  /** Items in "your move". */
  yourMoveCount: number;
  alert?: Alert;
  closed?: { at: string; reopen: ReopenRule };
  snoozedUntil?: string;
  /** Events after this ISO time are new. */
  seenUpTo?: string;
}

// Decisions: the only state that is mine. Append-only in decisions.jsonl.
interface DecisionBase { at: string }
export type Decision = DecisionBase & (
  | { kind: "merge"; from: string; into: string }
  | { kind: "move"; item: string; to: string }
  | { kind: "new_topic"; id: string; name: string }
  | { kind: "split"; item: string; id: string; name: string }
  | { kind: "close"; topic: string; reopen: ReopenRule }
  | { kind: "reopen"; topic: string }
  | { kind: "snooze"; topic: string; until: string }
  | { kind: "dismiss_action"; item: string }
  | { kind: "seen"; topic: string; upTo: string }
  | { kind: "area"; topic: string; area: string }
  | { kind: "name"; topic: string; name: string }
  | { kind: "colour"; topic: string; colour: string }
);
export type DecisionKind = Decision["kind"];

export interface WorkingHours {
  /** Hour of day, local time. */
  start: number;
  end: number;
  /** 0 = Sunday … 6 = Saturday */
  days: number[];
}

export interface AreaMap {
  repo: Record<string, string>;
  channel: Record<string, string>;
  team: Record<string, string>;
  gtd: Record<string, string>;
}

export interface Config {
  me: Person;
  people: Person[];
  areas: string[];
  areaMap: AreaMap;
  /** Linear team keys ("BG") that count as story keys in PR titles and branches. Empty: any KEY-123. */
  storyPrefixes: string[];
  /** GitHub logins that are bots or apps: their comments never ask anything of me. */
  bots: string[];
  colours: string[];
  workingHours: WorkingHours;
  /** Poll interval per source, in seconds. */
  intervals: Record<SourceName, number>;
  port: number;
  /** From env, never from config.json. */
  tokens: { slack?: string; linear?: string; notion?: string };
}

export interface SourceHealth {
  source: SourceName;
  ok: boolean;
  /** ISO time of the last good poll. */
  lastOk?: string;
  message?: string;
}
