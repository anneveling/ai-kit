// The poll loop: each source on its own interval. A failing source backs off
// (doubling, up to 15 min), keeps what it knew, and says why in the header.
// Never a silent gap.

import { createHash } from "node:crypto";
import type { Clock } from "./clock.ts";
import type { Store } from "./store.ts";
import type { Config, SourceHealth, SourceName } from "./types.ts";
import type { Source } from "./sources/source.ts";

const MAX_BACKOFF = 15 * 60_000;

interface State { failures: number; lastOk?: string; message?: string; signature?: string; timer?: NodeJS.Timeout }

export class Poller {
  #sources: Source[];
  #ctx: { config: Config; store: Store; clock: Clock };
  #onChange: () => void;
  #state = new Map<SourceName, State>();

  constructor(sources: Source[], ctx: { config: Config; store: Store; clock: Clock }, onChange: () => void) {
    this.#sources = sources;
    this.#ctx = ctx;
    this.#onChange = onChange;
    for (const s of sources) this.#state.set(s.name, { failures: 0, message: "starting…" });
  }

  health(): SourceHealth[] {
    return this.#sources.map((s) => {
      const st = this.#state.get(s.name)!;
      const ok = st.failures === 0 && Boolean(st.lastOk);
      return { source: s.name, ok, ...(st.lastOk ? { lastOk: st.lastOk } : {}), ...(ok ? {} : { message: st.message ?? "offline" }) };
    });
  }

  nextDelay(name: SourceName): number {
    const base = this.#ctx.config.intervals[name] * 1000;
    const st = this.#state.get(name)!;
    return Math.min(base * 2 ** st.failures, MAX_BACKOFF);
  }

  async pollOnce(name: SourceName): Promise<void> {
    const source = this.#sources.find((s) => s.name === name)!;
    const st = this.#state.get(name)!;
    const { config, store, clock } = this.#ctx;
    const wasOk = st.failures === 0 && Boolean(st.lastOk);
    try {
      const result = await source.poll({ config, store, now: clock.now() });
      st.failures = 0;
      st.message = undefined;
      st.lastOk = clock.now().toISOString();
      const signature = createHash("sha1").update(JSON.stringify(result)).digest("hex");
      if (signature !== st.signature || !wasOk) {
        st.signature = signature;
        store.put(name, result);
        this.#onChange();
      }
    } catch (e) {
      st.failures++;
      st.message = (e as Error).message;
      if (wasOk || st.failures === 1) this.#onChange(); // the header must say so
      console.error(`[bridge] ${name}: ${st.message}`);
    }
  }

  /** Polls every source once, in order (GitHub before Linear, so Linear sees the story keys), then each on its own timer. */
  async start(): Promise<void> {
    for (const s of this.#sources) await this.pollOnce(s.name);
    for (const s of this.#sources) this.#schedule(s.name);
  }

  #schedule(name: SourceName): void {
    const st = this.#state.get(name)!;
    st.timer = setTimeout(async () => {
      await this.pollOnce(name);
      this.#schedule(name);
    }, this.nextDelay(name));
  }

  stop(): void {
    for (const st of this.#state.values()) clearTimeout(st.timer);
  }
}
