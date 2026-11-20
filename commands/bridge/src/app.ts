// The running state: store + config + decisions + clock. Pages read views from
// here; decisions go through here. Every change bumps a version for SSE.

import { appendDecision, readDecisions, validateDecision } from "./decisions.ts";
import type { Clock } from "./clock.ts";
import type { Store } from "./store.ts";
import type { Config, Decision, SourceHealth } from "./types.ts";
import { bridgeView, topicView, type World } from "./view.ts";

export interface AppOptions {
  store: Store;
  config: Config;
  clock: Clock;
  decisionsPath: string;
  /** Decisions that come before the file's (the demo's own). */
  seedDecisions?: Decision[];
  health: () => SourceHealth[];
  /** owner/name → local clone, for Take the helm. */
  repoPaths?: (repos: string[]) => Record<string, string | null>;
}

export class App {
  version = 0;
  #listeners = new Set<(version: number) => void>();
  #decisions: Decision[];
  #problems: string[];
  private readonly opts: AppOptions;

  constructor(opts: AppOptions) {
    this.opts = opts;
    const { decisions, errors } = readDecisions(opts.decisionsPath);
    this.#decisions = [...(opts.seedDecisions ?? []), ...decisions];
    this.#problems = errors.map((e) => `decisions.jsonl line ${e.line} skipped: ${e.message}`);
  }

  world(): World {
    const { store, config, clock, health } = this.opts;
    const now = clock.now();
    return {
      items: store.items(), events: store.events(now), people: store.people, decisions: this.#decisions,
      config, now, health: health(), problems: this.#problems,
      repoPaths: this.#repoPaths(),
    };
  }

  #paths: { at: number; repos: string; value: Record<string, string | null> } = { at: 0, repos: "", value: {} };
  /** Re-read when the repos change, and at most once a minute otherwise, so edits to repos.json apply without a restart. */
  #repoPaths(): Record<string, string | null> {
    if (!this.opts.repoPaths) return {};
    const repos = [...new Set(this.opts.store.items().filter((i) => i.source === "github" && i.where).map((i) => i.where!))].sort();
    const key = repos.join(",");
    if (key !== this.#paths.repos || Date.now() - this.#paths.at > 60_000) {
      this.#paths = { at: Date.now(), repos: key, value: this.opts.repoPaths(repos) };
    }
    return this.#paths.value;
  }

  bridge() { return bridgeView(this.world()); }
  topic(id: string) { return topicView(this.world(), id); }

  /** Validates, stamps the time, appends to decisions.jsonl, and tells the pages. */
  decide(input: Record<string, unknown>): Decision {
    const decision = { ...input, at: this.opts.clock.now().toISOString() };
    const problem = validateDecision(decision);
    if (problem) throw new Error(problem);
    appendDecision(this.opts.decisionsPath, decision as Decision);
    this.#decisions.push(decision as Decision);
    this.changed();
    return decision as Decision;
  }

  changed(): void {
    this.version++;
    for (const l of this.#listeners) l(this.version);
  }

  subscribe(listener: (version: number) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
}
