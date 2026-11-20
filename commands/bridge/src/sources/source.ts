// What every source gives back on a poll.

import type { Config, Event, Item, Person, SourceName } from "../types.ts";
import type { Store } from "../store.ts";

export interface PollContext {
  config: Config;
  now: Date;
  /** What the other sources know, e.g. story keys PRs mention, for Linear. */
  store: Store;
}

export interface PollResult {
  items: Item[];
  events: Event[];
  /** People this source saw, to name them in the pages. */
  people: Person[];
}

export interface Source {
  name: SourceName;
  poll(ctx: PollContext): Promise<PollResult>;
}

/** Runs a CLI or HTTP call and returns parsed JSON, or throws with a reason. */
export type JsonCall = (args: string[]) => Promise<unknown>;
