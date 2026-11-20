// Items, events and people the sources know, for the last 14 days.
// In memory; rebuilt from the sources on start. Each source owns its own slice.

import type { Event, Item, Person, SourceName } from "./types.ts";

export const WINDOW_DAYS = 14;

export class Store {
  #items = new Map<SourceName, Item[]>();
  #events = new Map<SourceName, Event[]>();
  #people = new Map<SourceName, Person[]>();
  #base: Person[] = [];

  /** Replace everything one source knows with its latest poll. */
  put(source: SourceName, data: { items: Item[]; events: Event[]; people?: Person[] }): void {
    this.#items.set(source, data.items);
    this.#events.set(source, data.events);
    if (data.people) this.#people.set(source, data.people);
  }

  items(): Item[] { return [...this.#items.values()].flat(); }

  /** Events within the window, oldest first. */
  events(now: Date): Event[] {
    const cutoff = new Date(now.getTime() - WINDOW_DAYS * 86_400_000).toISOString();
    return [...this.#events.values()].flat().filter((e) => e.at >= cutoff).sort((a, b) => a.at.localeCompare(b.at));
  }

  /** People from config first; the sources add the ones they saw. */
  set people(base: Person[]) { this.#base = base; }
  get people(): Person[] {
    const byId = new Map(this.#base.map((p) => [p.id, p]));
    for (const p of [...this.#people.values()].flat()) if (!byId.has(p.id)) byId.set(p.id, p);
    return [...byId.values()];
  }
}
