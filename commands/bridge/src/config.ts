// Load, default and validate ~/.claude/bridge/config.json. Tokens come from env only.

import { existsSync, readFileSync } from "node:fs";
import type { AreaMap, Config, Person, SourceName, WorkingHours } from "./types.ts";

// Calm, distinct colours for the topic squares; a topic gets one by its id unless I pick one.
const COLOURS = [
  "#14b8a6", "#8b5cf6", "#f97316", "#3b82f6", "#c2410c", "#a16207",
  "#64748b", "#db2777", "#16a34a", "#0891b2", "#9333ea", "#ca8a04",
];

// gh gives app comments as a bare login without a bot flag, so these are named.
const BOTS = ["github-actions", "shopify", "vercel", "netlify", "codecov", "dependabot", "renovate", "sonarcloud", "coderabbitai", "copilot", "linear"];

// Poll intervals in seconds. Slack's are a guess until spike 0.5 sets them from its rate tiers.
const INTERVALS: Record<SourceName, number> = {
  github: 90,
  linear: 120,
  slack: 120,
  notion: 300,
  officer: 5,
};

export function defaults(): Omit<Config, "tokens"> {
  return {
    me: { id: "me", name: "You" },
    people: [],
    areas: ["Work", "Personal"],
    areaMap: { repo: {}, channel: {}, team: {}, gtd: {} },
    storyPrefixes: [],
    bots: [...BOTS],
    colours: [...COLOURS],
    workingHours: { start: 9, end: 18, days: [1, 2, 3, 4, 5] },
    intervals: { ...INTERVALS },
    port: 7766,
  };
}

type Env = Record<string, string | undefined>;

export function loadConfig(path: string, env: Env = process.env): Config {
  if (!existsSync(path)) return parseConfig({}, path, env);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    throw new Error(`${path}: not valid JSON (${(e as Error).message})`);
  }
  return parseConfig(raw, path, env);
}

export function parseConfig(raw: unknown, path: string, env: Env): Config {
  const fail = (msg: string): never => { throw new Error(`${path}: ${msg}`); };
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) fail("must be a JSON object");
  const f = raw as Record<string, unknown>;
  const d = defaults();

  const me: Person = { ...d.me, ...(f.me as object | undefined), id: "me" };
  const people = (f.people as Person[] | undefined) ?? d.people;
  if (!Array.isArray(people) || people.some((p) => typeof p?.id !== "string" || typeof p?.name !== "string")) {
    fail("people must be a list of { id, name, … }");
  }
  const areas = (f.areas as string[] | undefined) ?? d.areas;
  if (!Array.isArray(areas) || areas.length === 0 || areas.some((a) => typeof a !== "string")) {
    fail("areas must be a non-empty list of names");
  }

  const areaMap: AreaMap = { ...d.areaMap, ...(f.areaMap as Partial<AreaMap> | undefined) };
  for (const kind of ["repo", "channel", "team", "gtd"] as const) {
    for (const [key, area] of Object.entries(areaMap[kind] ?? {})) {
      if (!areas.includes(area)) {
        fail(`${kind} "${key}" maps to area "${area}", which is not in areas (${areas.join(", ")})`);
      }
    }
  }

  const workingHours: WorkingHours = { ...d.workingHours, ...(f.workingHours as Partial<WorkingHours> | undefined) };
  const { start, end, days } = workingHours;
  if (!(start >= 0 && end <= 24 && start < end) || !Array.isArray(days) || days.some((x) => x < 0 || x > 6)) {
    fail("workingHours needs 0 ≤ start < end ≤ 24 and days in 0–6 (0 = Sunday)");
  }

  const storyPrefixes = ((f.storyPrefixes as string[] | undefined) ?? d.storyPrefixes).map((x) => x.toUpperCase());
  const bots = [...new Set([...d.bots, ...((f.bots as string[] | undefined) ?? [])])].map((b) => b.toLowerCase());
  const colours = (f.colours as string[] | undefined) ?? d.colours;
  const intervals = { ...d.intervals, ...(f.intervals as Partial<Record<SourceName, number>> | undefined) };
  const port = (f.port as number | undefined) ?? d.port;

  return {
    me, people, areas, areaMap, storyPrefixes, bots, colours, workingHours, intervals, port,
    tokens: {
      slack: env.BRIDGE_SLACK_TOKEN || undefined,
      linear: env.BRIDGE_LINEAR_TOKEN || undefined,
      notion: env.BRIDGE_NOTION_TOKEN || undefined,
    },
  };
}

export function areaFor(config: Config, kind: keyof AreaMap, key: string): string | undefined {
  return config.areaMap[kind][key];
}
