// Linear through its GraphQL API with a personal key (BRIDGE_LINEAR_TOKEN).
// Stories: the ones assigned to me that moved in the window or are in progress,
// the ones my notifications point at (mentions, comments), plus every story a
// PR (or another source) refers to by key.

import { assessStory, type LinIssue, type LinPeople, type LinViewer } from "../rules/linear.ts";
import { WINDOW_DAYS } from "../store.ts";
import type { Config, Item, Person } from "../types.ts";
import type { PollContext, PollResult, Source } from "./source.ts";

export type Gql = (query: string, variables?: Record<string, unknown>) => Promise<Record<string, unknown>>;

export function linearGql(token: string, endpoint = "https://api.linear.app/graphql"): Gql {
  return async (query, variables) => {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: token },
      body: JSON.stringify({ query, variables }),
    });
    if (res.status === 401) throw new Error("Linear: the API key is not valid (401)");
    if (res.status === 429) throw new Error("Linear: rate limited (429)");
    const body = (await res.json().catch(() => ({}))) as { data?: Record<string, unknown>; errors?: { message: string }[] };
    if (!res.ok || body.errors?.length) throw new Error(`Linear: ${body.errors?.[0]?.message ?? `HTTP ${res.status}`}`);
    return body.data ?? {};
  };
}

const ISSUE_FIELDS = `
  id identifier title url updatedAt
  state { name type }
  assignee { id name }
  team { key }
  project { name progress targetDate }
  projectMilestone { name targetDate }
  comments(first: 50) { nodes { id body createdAt user { id name } parent { id user { id name } } } }
  history(first: 30) { nodes { createdAt actor { id name } fromState { name } toState { name } toAssignee { id name } } }
`;

const MINE = `query Mine($since: DateTimeOrDuration!) {
  viewer { id displayName name }
  issues(first: 100, filter: {
    assignee: { isMe: { eq: true } },
    or: [{ updatedAt: { gt: $since } }, { state: { type: { eq: "started" } } }]
  }) { nodes { ${ISSUE_FIELDS} } }
  notifications(first: 100) { nodes { type createdAt ... on IssueNotification { issue { identifier } } } }
}`;

// Notifications that can mean a comment waits on me. A story not assigned to
// me and not behind any PR of mine still shows up through these.
const ASKING = new Set(["issueMention", "issueCommentMention", "issueNewComment"]);

/** One query for many stories by key, with an alias per key. */
function byKeys(keys: string[]): string {
  return `query ByKey { ${keys.map((k, i) => `k${i}: issue(id: ${JSON.stringify(k)}) { ${ISSUE_FIELDS} }`).join("\n")} }`;
}

const BATCH = 20;

export class LinearSource implements Source {
  readonly name = "linear" as const;
  #gql: Gql;

  constructor(gql: Gql) { this.#gql = gql; }

  async poll({ config, now, store }: PollContext): Promise<PollResult> {
    const since = new Date(now.getTime() - WINDOW_DAYS * 86_400_000).toISOString();
    const mine = (await this.#gql(MINE, { since })) as {
      viewer: LinViewer & { name: string };
      issues: { nodes: LinIssue[] };
      notifications?: { nodes: { type: string; createdAt: string; issue?: { identifier: string } }[] };
    };
    const issues = new Map(mine.issues.nodes.map((i) => [i.identifier, i]));

    // Stories my notifications or other sources (PR titles and branches) point at.
    const notified = (mine.notifications?.nodes ?? [])
      .filter((n) => ASKING.has(n.type) && n.createdAt >= since && n.issue)
      .map((n) => n.issue!.identifier);
    const pointed = store.items().flatMap((i) => (i.storyKey && i.source !== "linear" ? [i.storyKey] : []));
    const wanted = [...new Set([...notified, ...pointed])].filter((k) => !issues.has(k));
    for (let i = 0; i < wanted.length; i += BATCH) {
      const batch = wanted.slice(i, i + BATCH);
      // A key that isn't a Linear story (e.g. "UTF-8") comes back null or as an error: skip it, keep the rest.
      const data = await this.#gql(byKeys(batch)).catch(() => this.#oneByOne(batch));
      for (const v of Object.values(data)) if (v) issues.set((v as LinIssue).identifier, v as LinIssue);
    }
    return this.#toResult([...issues.values()], mine.viewer, config);
  }

  async #oneByOne(keys: string[]): Promise<Record<string, unknown>> {
    const out: Record<string, unknown> = {};
    for (const [i, k] of keys.entries()) {
      const data = await this.#gql(byKeys([k])).catch(() => ({}));
      out[`k${i}`] = (data as Record<string, unknown>).k0 ?? null;
    }
    return out;
  }

  #toResult(issues: LinIssue[], viewer: LinViewer, config: Config): PollResult {
    const byHandle = new Map(config.people.filter((p) => p.linear).map((p) => [p.linear!, p]));
    const people: LinPeople = {
      id: (uid) => (uid === viewer.id ? "me" : byHandle.get(uid)?.id ?? `linear:${uid}`),
      name: (uid, full) => (uid === viewer.id ? "you" : byHandle.get(uid)?.name ?? full.split(" ")[0] ?? full),
    };
    const items: Item[] = [];
    const events = [];
    const persons = new Map<string, Person>();
    for (const issue of issues) {
      const r = assessStory(issue, viewer, people);
      items.push({
        id: `linear:${issue.identifier}`, source: "linear", kind: "story", title: issue.title, url: issue.url,
        storyKey: issue.identifier, area: config.areaMap.team[issue.team.key], where: issue.project?.name ?? issue.team.key,
        status: r.status, assessment: r.assessment, ...(r.context ? { context: r.context } : {}),
      });
      events.push(...r.events);
      const users = [issue.assignee, ...issue.comments.nodes.map((c) => c.user), ...issue.history.nodes.map((x) => x.actor)];
      for (const u of users) {
        if (!u || u.id === viewer.id) continue;
        const pid = people.id(u.id);
        if (!persons.has(pid)) persons.set(pid, { id: pid, name: people.name(u.id, u.name), linear: u.id });
      }
    }
    return { items, events, people: [...persons.values()] };
  }
}
