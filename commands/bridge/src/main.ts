// bridge: one local page for everything I need to do, answer or keep an eye on.
//
//   node src/main.ts            real sources: GitHub (gh), Linear (with a key)
//   node src/main.ts --demo     made-up data from demo/demo.json, fixed clock
//   options: --port <n>, --no-open, --record (save real responses to
//   $BRIDGE_HOME/recordings/; BRIDGE_REPLAY=<that folder> plays them back)
//
// State lives in $BRIDGE_HOME (default ~/.claude/bridge). Tokens come from env;
// $BRIDGE_HOME/.env (chmod 600; or $BRIDGE_ENV) is read first, so they needn't live in a shell profile.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { App } from "./app.ts";
import { systemClock } from "./clock.ts";
import { loadConfig } from "./config.ts";
import { demoApp } from "./demo.ts";
import { startServer } from "./server.ts";
import { Poller } from "./poll.ts";
import { localRepoPaths } from "./repos.ts";
import { Store } from "./store.ts";
import { recording, replaying } from "./record.ts";
import { GitHubSource, ghCall } from "./sources/github.ts";
import { LinearSource, linearGql, type Gql } from "./sources/linear.ts";
import type { Source } from "./sources/source.ts";
import type { SourceHealth } from "./types.ts";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const option = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };

const home = process.env.BRIDGE_HOME ?? join(homedir(), ".claude", "bridge");
const demoMode = flag("--demo");
const envFile = process.env.BRIDGE_ENV ?? join(home, ".env");
if (existsSync(envFile)) process.loadEnvFile(envFile);
let app: App;

if (demoMode) {
  app = demoApp(join(home, "decisions.demo.jsonl"));
} else {
  const config = loadConfig(join(home, "config.json"));
  const store = new Store();
  store.people = config.people;
  const recordings = process.env.BRIDGE_REPLAY ?? join(home, "recordings");
  // Each call goes live, live and recorded, or replayed from recordings.
  const wrap = <A extends unknown[]>(live: (...a: A) => Promise<unknown>, name: string) =>
    process.env.BRIDGE_REPLAY ? replaying<A>(join(recordings, name))
      : flag("--record") ? recording(live, join(recordings, name)) : live;
  const sources: Source[] = [new GitHubSource(wrap(ghCall(), "github"))];
  const missing: SourceHealth[] = [];
  if (config.tokens.linear || process.env.BRIDGE_REPLAY) {
    sources.push(new LinearSource(wrap(linearGql(config.tokens.linear ?? ""), "linear") as Gql));
  }
  else missing.push({ source: "linear", ok: false, message: "no key yet: BRIDGE_LINEAR_TOKEN in ~/.claude/bridge/.env" });
  const poller = new Poller(sources, { config, store, clock: systemClock }, () => app.changed());
  app = new App({
    store, config, clock: systemClock, decisionsPath: join(home, "decisions.jsonl"),
    health: () => [...poller.health(), ...missing],
    repoPaths: (repos) => localRepoPaths(repos, home),
  });
  poller.start().catch((e) => console.error("[bridge] poll:", e));
}

const port = Number(option("--port") ?? (demoMode ? 7767 : app.world().config.port));
const server = await startServer(app, port);
const url = `http://127.0.0.1:${port}/`;
console.log(`bridge${demoMode ? " (demo)" : ""} on ${url}`);
if (!flag("--no-open") && process.platform === "darwin") spawn("open", [url], { stdio: "ignore", detached: true }).unref();

process.on("SIGINT", () => { server.close(); process.exit(0); });
