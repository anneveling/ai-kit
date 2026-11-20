import { test } from "node:test";
import assert from "node:assert/strict";
import { assessStory, type LinIssue, type LinComment } from "../src/rules/linear.ts";

const ME = { id: "u-me", displayName: "ghost" };
const h = (hoursAgo: number) => new Date(Date.parse("2026-11-20T12:00:00Z") - hoursAgo * 3_600_000).toISOString();
const people = { id: (uid: string) => (uid === ME.id ? "me" : uid.replace("u-", "")), name: (_uid: string, name: string) => name.split(" ")[0]! };

let n = 0;
function comment(user: string, hoursAgo: number, body: string, parent?: LinComment): LinComment {
  n++;
  return { id: `c${n}`, body, createdAt: h(hoursAgo), user: { id: `u-${user}`, name: user[0]!.toUpperCase() + user.slice(1) }, parent: parent ? { id: parent.id, user: parent.user } : null };
}
function issue(over: Partial<LinIssue> = {}): LinIssue {
  return {
    id: "i1", identifier: "AC-1636", title: "Payout retries", url: "https://linear.app/acme/issue/AC-1636",
    updatedAt: h(5), state: { name: "In Review", type: "started" }, assignee: { id: ME.id, name: "Ghost" },
    team: { key: "AC" }, project: { name: "Payouts v2", progress: 0.62, targetDate: "2026-12-12" },
    projectMilestone: { name: "Go-live", targetDate: "2026-12-12" },
    comments: { nodes: [] }, history: { nodes: [] }, ...over,
  };
}
const run = (i: LinIssue) => assessStory(i, ME, people);

test("a story assigned to me with no comments is work, not attention: quiet", () => {
  const r = run(issue());
  assert.equal(r.assessment.state, "quiet");
  assert.equal(r.assessment.line, "AC-1636 is in review");
  assert.deepEqual(r.status, { label: "in review", tone: "active" });
});

test("project, milestone and progress make the context line", () => {
  assert.equal(run(issue()).context, "Payouts v2 · Go-live 12 Dec · 62%");
  assert.equal(run(issue({ project: null, projectMilestone: null })).context, undefined);
});

test("a comment that mentions me puts the ball with me: reply", () => {
  const r = run(issue({ comments: { nodes: [comment("sam", 3, "@ghost can we ship this today?")] } }));
  assert.equal(r.assessment.state, "your_move");
  assert.deepEqual(r.assessment.ball, ["me"]);
  assert.equal(r.assessment.next?.verb, "reply");
  assert.equal(r.assessment.stuck, undefined, "yellow, never red, until the model check says it's a question");
  assert.equal(r.assessment.since, h(3));
  assert.match(r.assessment.line, /Sam mentioned you on AC-1636/);
});

test("a mention as a profile link counts too", () => {
  const r = run(issue({ comments: { nodes: [comment("sam", 3, "[ghost](https://linear.app/acme/profiles/ghost) thoughts?")] } }));
  assert.equal(r.assessment.state, "your_move");
});

test("a reply to my comment puts the ball with me", () => {
  const mine = comment("me", 5, "should retries stop after 3?");
  mine.user = { id: ME.id, name: "Ghost" };
  const reply = comment("toby", 2, "yes, 3 is fine", mine);
  const r = run(issue({ comments: { nodes: [mine, reply] } }));
  assert.equal(r.assessment.state, "your_move");
  assert.match(r.assessment.line, /Toby replied to you on AC-1636/);
});

test("a later comment of mine in the thread answers it", () => {
  const ask = comment("sam", 5, "@ghost ok to ship?");
  const answer = comment("me", 1, "yes", ask);
  answer.user = { id: ME.id, name: "Ghost" };
  assert.equal(run(issue({ comments: { nodes: [ask, answer] } })).assessment.state, "quiet");
});

test("a comment that doesn't involve me is just a log event", () => {
  const r = run(issue({ comments: { nodes: [comment("sam", 2, "Toby, can you check the staging run?")] } }));
  assert.equal(r.assessment.state, "quiet");
  assert.ok(r.events.some((e) => e.text.startsWith("commented on AC-1636")));
});

test("status and assignee changes are log events only, and routine", () => {
  const r = run(issue({ history: { nodes: [
    { createdAt: h(4), actor: { id: "u-sam", name: "Sam Lee" }, fromState: { name: "In Progress" }, toState: { name: "In Review" } },
    { createdAt: h(6), actor: { id: "u-sam", name: "Sam Lee" }, toAssignee: { id: ME.id, name: "Ghost" } },
  ] } }));
  assert.equal(r.assessment.state, "quiet");
  const texts = r.events.map((e) => `${e.who}: ${e.text}${e.routine ? " (routine)" : ""}`);
  assert.deepEqual(texts.sort(), ["sam: AC-1636 → In Review (routine)", "sam: assigned AC-1636 to Ghost (routine)"]);
});

test("done and cancelled stories are done", () => {
  assert.deepEqual(run(issue({ state: { name: "Done", type: "completed" } })).status, { label: "done", tone: "done" });
  assert.deepEqual(run(issue({ state: { name: "Todo", type: "unstarted" } })).status, { label: "todo", tone: "idle" });
  assert.deepEqual(run(issue({ state: { name: "Duplicate", type: "duplicate" } })).status, { label: "duplicate", tone: "done" });
});

test("on a done or cancelled story a mention is only a log line", () => {
  const ask = comment("sam", 3, "@ghost #1035 is up for review");
  for (const type of ["completed", "canceled"]) {
    const r = run(issue({ state: { name: "Done", type }, comments: { nodes: [ask] } }));
    assert.equal(r.assessment.state, "quiet");
    assert.ok(r.events.some((e) => e.text.includes("#1035 is up for review")));
  }
});
