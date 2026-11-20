// Linear: one story → its state, and whether a comment waits on me. Pure.
//
// A comment that mentions me, or replies in a thread I'm in, puts the ball
// with me (reply) until I comment in that thread again. It stays yellow, never
// red: on real data most are status updates, not questions, until phase 3's
// model check can tell them apart. On a done or cancelled story it's only a
// log line. Status and assignee changes are log events only. A story assigned to me is work, not attention:
// on its own it doesn't make it my move.

import type { Assessment, BallHolder, Event, ItemTone } from "../types.ts";

export interface LinUser { id: string; name: string }
export interface LinComment {
  id: string;
  body: string;
  createdAt: string;
  user: LinUser | null;
  parent: { id: string; user: LinUser | null } | null;
}
export interface LinHistory {
  createdAt: string;
  actor: LinUser | null;
  fromState?: { name: string } | null;
  toState?: { name: string } | null;
  toAssignee?: LinUser | null;
}
export interface LinIssue {
  id: string;
  identifier: string;
  title: string;
  url: string;
  updatedAt: string;
  state: { name: string; type: string };
  assignee: LinUser | null;
  team: { key: string };
  project: { name: string; progress: number; targetDate?: string | null } | null;
  projectMilestone: { name: string; targetDate?: string | null } | null;
  comments: { nodes: LinComment[] };
  history: { nodes: LinHistory[] };
}

export interface LinViewer { id: string; displayName: string }
export interface LinPeople { id(userId: string): BallHolder; name(userId: string, fullName: string): string }

export interface StoryResult {
  assessment: Assessment;
  status: { label: string; tone: ItemTone };
  context?: string;
  events: Event[];
}

const TONE: Record<string, ItemTone> = { completed: "done", canceled: "done", duplicate: "done", started: "active", unstarted: "idle", backlog: "idle", triage: "attention" };

function mentions(body: string, viewer: LinViewer): boolean {
  const name = viewer.displayName.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\w])@${name}\\b|/profiles/${name}\\b`, "i").test(body);
}

function shortDate(iso?: string | null): string {
  if (!iso) return "";
  return new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

export function contextOf(issue: LinIssue): string | undefined {
  const parts: string[] = [];
  if (issue.project) parts.push(issue.project.name);
  const m = issue.projectMilestone;
  if (m) parts.push([m.name, shortDate(m.targetDate)].filter(Boolean).join(" "));
  if (issue.project) parts.push(`${Math.round(issue.project.progress * 100)}%`);
  return parts.length ? parts.join(" · ") : undefined;
}

export function assessStory(issue: LinIssue, viewer: LinViewer, people: LinPeople): StoryResult {
  const key = issue.identifier;
  const itemId = `linear:${key}`;
  const comments = [...issue.comments.nodes].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const isMine = (c: { user: LinUser | null }) => c.user?.id === viewer.id;
  const threadOf = (c: LinComment) => c.parent?.id ?? c.id;
  const threadsImIn = new Set(comments.filter(isMine).map(threadOf));
  const nameOf = (u: LinUser | null) => (u ? people.name(u.id, u.name) : "Someone");

  const finished = ["completed", "canceled", "duplicate"].includes(issue.state.type);
  // The latest comment to me that I haven't answered since.
  let open: { c: LinComment; why: "mentioned you" | "replied to you" } | undefined;
  for (const c of comments) {
    if (isMine(c)) {
      if (open && (threadOf(open.c) === threadOf(c) || !open.c.parent)) open = undefined;
      continue;
    }
    if (mentions(c.body, viewer)) open = { c, why: "mentioned you" };
    else if (c.parent && (isMine(c.parent) || threadsImIn.has(threadOf(c)))) open = { c, why: "replied to you" };
  }

  const stateName = issue.state.name.toLowerCase();
  const status = { label: stateName, tone: TONE[issue.state.type] ?? "idle" };
  const assessment: Assessment = open && !finished
    ? {
      ball: ["me"], state: "your_move", since: open.c.createdAt,
      line: `${nameOf(open.c.user)} ${open.why} on ${key}`,
      next: { verb: "reply", label: `Reply to ${nameOf(open.c.user)} on ${key}`, officer: "Claude drafts the reply", helm: "you reply" },
    }
    : { ball: [], state: "quiet", since: issue.updatedAt, line: `${key} is ${stateName}` };

  const events: Event[] = [];
  const add = (at: string, who: LinUser | null, text: string, routine = false) =>
    events.push({ id: `${itemId}@${at}:${events.length}`, itemId, source: "linear", at, who: who ? people.id(who.id) : "unknown", text, ...(routine ? { routine } : {}) });
  for (const c of comments) add(c.createdAt, c.user, `commented on ${key}${quote(c.body)}`);
  for (const hst of issue.history.nodes) {
    if (hst.toState) add(hst.createdAt, hst.actor, `${key} → ${hst.toState.name}`, true);
    else if (hst.toAssignee) add(hst.createdAt, hst.actor, `assigned ${key} to ${hst.toAssignee.name.split(" ")[0]}`, true);
  }

  return { assessment, status, context: contextOf(issue), events };
}

function quote(body: string): string {
  const line = body.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/\s+/g, " ").trim();
  if (!line) return "";
  return `: “${line.length > 90 ? `${line.slice(0, 88)}…` : line}”`;
}
