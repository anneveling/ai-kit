// --record writes every real source response to $BRIDGE_HOME/recordings/<source>/
// (outside git). BRIDGE_REPLAY=<that folder> answers from those files instead,
// so I can test against my own data without the network.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Dates in the args (the window's start) differ per run, so they don't count in the key.
const keyOf = (args: unknown[]) => createHash("sha1")
  .update(JSON.stringify(args).replace(/\d{4}-\d{2}-\d{2}(T[\d:.]+Z)?/g, "<date>"))
  .digest("hex").slice(0, 16);

export function recording<A extends unknown[]>(call: (...a: A) => Promise<unknown>, dir: string): (...a: A) => Promise<unknown> {
  mkdirSync(dir, { recursive: true });
  return async (...args) => {
    const response = await call(...args);
    writeFileSync(join(dir, `${keyOf(args)}.json`), JSON.stringify({ args, response }, null, 1));
    return response;
  };
}

export function replaying<A extends unknown[]>(dir: string): (...a: A) => Promise<unknown> {
  return async (...args) => {
    const file = join(dir, `${keyOf(args)}.json`);
    if (!existsSync(file)) throw new Error(`replay: nothing recorded for ${JSON.stringify(args).slice(0, 80)}`);
    return (JSON.parse(readFileSync(file, "utf8")) as { response: unknown }).response;
  };
}
