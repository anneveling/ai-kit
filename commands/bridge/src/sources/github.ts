// GitHub through the gh CLI, the way pr-watch does it: three searches for open
// PRs (mine, my review asked, reviewed by me) plus my PRs merged in the window,
// then `gh pr view` per PR. When a PR's search updatedAt hasn't changed, only
// the fields that change without bumping it (CI, reviews, requests) are refreshed.

import { spawn } from "node:child_process";
import { assessPr, prEvents, storyKeyOf, type GhPr, type People } from "../rules/github.ts";
import { WINDOW_DAYS } from "../store.ts";
import type { BallHolder, Config, Item, Person } from "../types.ts";
import type { JsonCall, PollContext, PollResult, Source } from "./source.ts";

const SEARCH_FIELDS = "number,title,url,repository,updatedAt";
const VIEW_FIELDS = "number,title,url,author,isDraft,reviewDecision,statusCheckRollup,reviews,reviewRequests,state,createdAt,updatedAt,mergeable,mergeStateStatus,headRefName,commits,comments,mergedAt,closedAt,mergedBy";
// These can change without bumping the search index's updatedAt.
const REFRESH_FIELDS = "statusCheckRollup,mergeStateStatus,reviewDecision,reviewRequests,reviews,isDraft,mergeable,state";
const PARALLEL = 4;

/** `gh <args>` → parsed JSON. Throws with gh's own message when it fails. */
export function ghCall(bin = process.env.BRIDGE_GH_BIN ?? "gh"): JsonCall {
  return (args) => new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { err += d; });
    child.on("error", (e) => reject(new Error(`gh: ${e.message}`)));
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(`gh ${args.slice(0, 2).join(" ")}: ${err.trim().split("\n")[0] || `exit ${code}`}`));
      try { resolve(JSON.parse(out)); } catch { reject(new Error(`gh ${args.slice(0, 2).join(" ")}: not JSON`)); }
    });
  });
}

interface Summary { url: string; repo: string; updatedAt: string }
interface Cached { pr: GhPr; searchUpdatedAt: string }
type RawPr = Omit<GhPr, "repo" | "reviewRequests"> & { reviewRequests?: ({ login?: string; slug?: string; name?: string } | string)[] };

const repoOfUrl = (url: string) => url.replace(/^https:\/\/github\.com\//, "").replace(/\/pull\/\d+.*$/, "");

function normalise(raw: RawPr, repo: string): GhPr {
  return {
    ...raw,
    repo,
    reviewRequests: (raw.reviewRequests ?? []).map((r) => (typeof r === "string" ? r : r.login ?? `team:${r.slug ?? r.name}`)),
    reviews: raw.reviews ?? [],
    statusCheckRollup: raw.statusCheckRollup ?? [],
    commits: raw.commits ?? [],
    comments: raw.comments ?? [],
  };
}

async function inBatches<T, R>(xs: T[], size: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < xs.length; i += size) out.push(...(await Promise.all(xs.slice(i, i + size).map(fn))));
  return out;
}

export function githubPeople(config: Config, me: string, seen: Map<string, string | undefined>): People {
  const byHandle = new Map(config.people.filter((p) => p.github).map((p) => [p.github!.toLowerCase(), p]));
  const bots = new Set(config.bots);
  return {
    bot: (login) => bots.has(login.toLowerCase()),
    id: (login): BallHolder => (login === me ? "me" : byHandle.get(login.toLowerCase())?.id ?? login),
    name: (login) => {
      if (login === me) return "you";
      const known = byHandle.get(login.toLowerCase());
      if (known) return known.name;
      return seen.get(login)?.split(" ")[0] || login;
    },
  };
}

export class GitHubSource implements Source {
  readonly name = "github" as const;
  #gh: JsonCall;
  #cache = new Map<string, Cached>();
  #me?: string;

  constructor(gh: JsonCall = ghCall()) { this.#gh = gh; }

  async poll({ config, now }: PollContext): Promise<PollResult> {
    this.#me ??= config.me.github ?? ((await this.#gh(["api", "user"])) as { login: string }).login;
    const me = this.#me;
    const since = new Date(now.getTime() - WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);
    const search = (...q: string[]) => this.#gh(["search", "prs", ...q, "--json", SEARCH_FIELDS, "--limit", "100"]);
    const results = await Promise.all([
      search("--state", "open", "--author", "@me"),
      search("--state", "open", "--review-requested", "@me"),
      search("--state", "open", "--reviewed-by", "@me"),
      search("--author", "@me", "--merged", "--updated", `>=${since}`),
    ]) as { url: string; repository: { nameWithOwner: string }; updatedAt: string }[][];

    const summaries = new Map<string, Summary>();
    for (const r of results.flat()) summaries.set(r.url, { url: r.url, repo: r.repository.nameWithOwner, updatedAt: r.updatedAt });
    // Still-open PRs that dropped out of the searches (e.g. I reviewed and was taken off): look once more.
    for (const [url, c] of this.#cache) {
      if (!summaries.has(url) && c.pr.state === "OPEN") summaries.set(url, { url, repo: c.pr.repo, updatedAt: "" });
    }

    const prs = await inBatches([...summaries.values()], PARALLEL, (s) => this.#fetch(s));
    const kept = prs.filter((p): p is GhPr => p !== null)
      .filter((p) => p.state === "OPEN" || (p.mergedAt ?? p.closedAt ?? p.updatedAt) >= since);
    for (const url of this.#cache.keys()) if (!kept.some((p) => p.url === url)) this.#cache.delete(url);
    return this.#toResult(kept, config, me, now);
  }

  async #fetch(s: Summary): Promise<GhPr | null> {
    const cached = this.#cache.get(s.url);
    try {
      let pr: GhPr;
      if (cached && s.updatedAt && cached.searchUpdatedAt === s.updatedAt) {
        if (cached.pr.state !== "OPEN") return cached.pr;
        const fresh = (await this.#gh(["pr", "view", s.url, "--json", REFRESH_FIELDS])) as Partial<RawPr>;
        pr = normalise({ ...cached.pr, ...fresh } as RawPr, s.repo);
      } else {
        pr = normalise((await this.#gh(["pr", "view", s.url, "--json", VIEW_FIELDS])) as RawPr, s.repo || repoOfUrl(s.url));
      }
      this.#cache.set(s.url, { pr, searchUpdatedAt: s.updatedAt });
      return pr;
    } catch {
      return cached?.pr ?? null; // keep what we knew; the next poll tries again
    }
  }

  #toResult(prs: GhPr[], config: Config, me: string, now: Date): PollResult {
    const seen = new Map<string, string | undefined>();
    for (const p of prs) seen.set(p.author.login, p.author.name);
    const people = githubPeople(config, me, seen);
    const prefixes = config.storyPrefixes;
    const items: Item[] = [];
    const events = [];
    const persons = new Map<string, Person>();
    for (const pr of prs) {
      const id = `github:${pr.repo}#${pr.number}`;
      const { assessment, status } = assessPr(pr, me, now, people);
      items.push({
        id, source: "github", kind: "pr", title: `#${pr.number} ${pr.title}`, url: pr.url,
        storyKey: storyKeyOf(pr, prefixes), area: config.areaMap.repo[pr.repo] ?? config.areaMap.repo[`${pr.repo.split("/")[0]}/*`], where: pr.repo,
        status, assessment,
      });
      events.push(...prEvents(pr, id, people));
      const logins = [pr.author.login, ...pr.reviewRequests, ...pr.reviews.flatMap((r) => (r.author ? [r.author.login] : [])), ...pr.comments.flatMap((c) => (c.author ? [c.author.login] : []))];
      for (const login of logins) {
        if (people.bot?.(login)) continue;
        const pid = people.id(login);
        if (pid !== "me" && !persons.has(pid)) persons.set(pid, { id: pid, name: people.name(login), github: login });
      }
    }
    return { items, events, people: [...persons.values()] };
  }
}
