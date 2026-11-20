// One topic: briefing, log, Tell Claude (left); Next and where things stand (right).

const root = document.getElementById("root");
const topicId = decodeURIComponent(location.pathname.slice("/t/".length));
let firstSeen;          // "new" is decided against what was seen when this tab opened
let panel = null;       // open control panel: "snooze" | "close" | "edit" | null
const LOG_SHOWN = 14;
let showOlder = false;

const REOPEN = {
  ball_to_me: "when the ball comes to me",
  any_activity: "on any activity",
  never: "never",
};

function snoozeOptions(nowIso) {
  const now = new Date(nowIso);
  const at9 = (d) => { const x = new Date(now); x.setDate(x.getDate() + d); x.setHours(9, 0, 0, 0); return x; };
  const monday = (8 - now.getDay()) % 7 || 7;
  return [
    ["3 hours", new Date(now.getTime() + 3 * 3600000)],
    ["tomorrow 09:00", at9(1)],
    ["Monday 09:00", at9(monday)],
    ["a week", at9(7)],
  ];
}

function headHtml(v) {
  const t = v.topic;
  const status = t.closed
    ? `<span class="muted">Closed · reopens ${esc(REOPEN[t.closed.reopen])}</span>`
    : t.snoozedUntil
      ? `<span class="muted">Snoozed until ${esc(whenLabel(t.snoozedUntil))}</span>`
      : `<span class="${ballClass(t)}">${esc(t.ball)}</span>` +
        (t.yourMoveCount ? ` <span class="muted">· on ${t.yourMoveCount} of ${t.itemCount} items</span>` : ` <span class="muted">· ${t.itemCount} items</span>`) +
        (t.since ? ` <span class="muted">· ${ago(t.since, v.now)}</span>` : "");
  const controls = t.closed
    ? `<button class="link" data-act="reopen">reopen</button>`
    : `<button class="link" data-panel="snooze">${t.snoozedUntil ? "snoozed" : "snooze"}</button>
       <button class="link" data-panel="close">close</button>`;
  return `<div class="thead" style="--c:${esc(t.colour)}">
    <div><span class="label">${esc(t.area)}</span><h2><span class="sq"></span>${esc(t.name)}</h2><div class="sm">${status}</div></div>
    <div class="controls">${controls}<button class="link" data-panel="edit">edit</button>
      <a class="link" href="/" target="bridge-main">bridge</a></div>
  </div>${panelHtml(v)}`;
}

function panelHtml(v) {
  const t = v.topic;
  if (panel === "snooze") {
    return `<div class="panel"><div class="row"><span>Snooze for</span>${snoozeOptions(v.now)
      .map(([label, d]) => `<button class="link" data-snooze="${d.toISOString()}">${label}</button>`).join("")}</div>
      <div class="sm muted">It leaves the hot topics and shows as snoozed in the table until then.</div></div>`;
  }
  if (panel === "close") {
    return `<div class="panel"><div class="row"><span>Close, and reopen</span>${Object.entries(REOPEN)
      .map(([k, label]) => `<button class="link" data-close="${k}">${label}</button>`).join("")}</div></div>`;
  }
  if (panel === "edit") {
    return `<div class="panel">
      <div class="row"><span>Name</span><input id="ed-name" value="${esc(t.name)}" size="32"></div>
      <div class="row"><span>Colour</span>${v.colours.map((c) => `<button class="swatch${c === t.colour ? " on" : ""}" style="--c:${esc(c)}" data-colour="${esc(c)}" title="${esc(c)}"></button>`).join("")}</div>
      <div class="row"><span>Area</span><select id="ed-area">${v.areas.map((a) => `<option${a === t.area ? " selected" : ""}>${esc(a)}</option>`).join("")}</select></div>
      <div class="row"><button class="link" data-act="save-edit">save</button><button class="link" data-panel="">cancel</button></div>
    </div>`;
  }
  return "";
}

function logHtml(v) {
  const isNew = (e) => !firstSeen || e.at > firstSeen;
  // First version of the roll-up: routine events on the same day become one line.
  const entries = [];
  for (const e of v.log) {
    const day = dayLabel(e.at, v.now);
    const last = entries.at(-1);
    if (e.routine && last?.routine && last.day === day) { last.texts.push(e.text); last.isNew ||= isNew(e); continue; }
    entries.push({ ...e, day, texts: [e.text], isNew: isNew(e) });
  }
  const shown = showOlder ? entries : entries.slice(0, LOG_SHOWN);
  let html = "";
  let day = "";
  for (const e of shown) {
    if (e.day !== day) { day = e.day; html += `<div class="day">${esc(day)}</div>`; }
    const cls = ["ev", e.isNew && "new", e.mine && !e.routine && "mine", e.routine && "roll", e.tone].filter(Boolean).join(" ");
    const text = e.routine && e.texts.length > 1
      ? esc(e.texts.join(" · "))
      : `${e.who === "CI" ? "" : `<span class="who">${esc(e.who)}</span> `}${esc(e.text)}`;
    html += `<div class="${cls}"><span class="muted">${e.routine && e.texts.length > 1 ? "·" : hhmm(e.at)}</span><span class="src">${esc(e.source.toUpperCase())}</span><span class="txt">${text}</span></div>`;
  }
  if (entries.length > LOG_SHOWN) {
    html += `<button class="link" data-act="older" style="margin-top:6px">${showOlder ? "show fewer" : `show older (${entries.length - LOG_SHOWN})`}</button>`;
  }
  return html || `<div class="muted">Nothing happened here in the last 14 days.</div>`;
}

// Make it so comes alive in phase 6. Take the helm works for PRs: it opens
// Claude in the repo's clone with the action filled in (not sent).
function ctas(officer, helm, helmUrl) {
  return (officer ? `<button class="cta so" disabled title="The officer arrives in phase 6">Make it so<small>${esc(officer)}</small></button>` : "") +
    (helmUrl
      ? `<a class="cta helm" href="${esc(helmUrl)}" title="Opens Claude Code with this filled in">Take the helm<small>${esc(helm ?? "you do it")}</small></a>`
      : `<button class="cta helm" disabled title="For this source it comes with the officer in phase 6">Take the helm<small>${esc(helm ?? "you do it")}</small></button>`);
}

function nextHtml(v) {
  if (v.next.length === 0) return `<div class="muted">Nothing for you to do here.</div>`;
  return v.next.map((n) => `<div class="na">
    <div class="h">${esc(n.label)}</div>
    ${n.reason ? `<div class="why">${esc(n.reason)}</div>` : ""}
    ${n.state === "waiting" ? `<div class="why">waiting · ${ago(n.since, v.now)}</div>` : ""}
    <div class="acts">${ctas(n.officer, n.helm, n.helmUrl)}<button class="link" data-dismiss="${esc(n.itemId)}" title="Hide it until the ball moves again">dismiss</button></div>
  </div>`).join("");
}

function itemLine(i, v, open) {
  const title = i.url ? `<a href="${esc(i.url)}" target="_blank" rel="noopener">${esc(i.title)}</a>` : esc(i.title);
  return `<div class="att"><span class="title">${title}</span><span class="t-${i.status.tone}">${esc(i.status.label)}</span>
    <span class="move${open ? " open" : ""}">${moveSelect(i.id, v.openTopics)}</span></div>`;
}

const allOpen = new Set();
function sourcesHtml(v) {
  return v.sources.map((s) => {
    const total = s.bar.reduce((n, x) => n + x.n, 0);
    const showAll = allOpen.has(s.source);
    const shown = showAll ? s.items : s.items.filter((i) => i.needs);
    return `<div class="src-block">
      <div class="top-line"><span><span class="s">${esc(s.label.toUpperCase())}</span><b>${esc(s.noun)}</b></span><span class="sm muted">${esc(s.summary)}</span></div>
      ${total > 1 ? `<div class="seg">${s.bar.map((x) => `<i class="${x.tone}" style="width:${(100 * x.n) / total}%"></i>`).join("")}</div>` : ""}
      ${s.contexts.map((c) => `<div class="sm muted">${esc(c)}</div>`).join("")}
      ${shown.map((i) => itemLine(i, v, false)).join("")}
      ${s.items.length > shown.length || showAll ? `<button class="link" data-all="${esc(s.source)}">${showAll ? "only what needs something" : `all ${s.items.length}`}</button>` : ""}
    </div>`;
  }).join("");
}

function render(v) {
  document.title = `${v.topic.name} · Bridge`;
  root.innerHTML = headerHtml(v, `<a href="/" target="bridge-main">Bridge</a>`) + headHtml(v) + `<div class="two">
    <div>
      <div class="brief">${v.briefing.map((p) => `<p>${esc(p)}</p>`).join("")}
        <button class="link" disabled title="Asks Claude; comes in phase 5">deeper briefing</button></div>
      <h5>Log · newest first</h5>${logHtml(v)}
      <h5>Tell Claude</h5>
      <div class="tell"><textarea placeholder="say something about this topic…" disabled title="Comes in phase 5"></textarea>
        <div class="acts">${ctas("Claude takes it from here", "talk it through yourself")}</div></div>
    </div>
    <div>
      <h5>Next</h5>${nextHtml(v)}
      <h5>Where things stand</h5>${sourcesHtml(v)}
    </div>
  </div>`;
  wire(v);
}

function wire(v) {
  const on = (sel, fn) => root.querySelectorAll(sel).forEach((el) => el.addEventListener("click", () => fn(el)));
  const t = v.topic;
  on("[data-panel]", (el) => { panel = el.dataset.panel === panel ? null : el.dataset.panel || null; render(v); });
  on("[data-snooze]", async (el) => { panel = null; await decide({ kind: "snooze", topic: t.id, until: el.dataset.snooze }); });
  on("[data-close]", async (el) => { panel = null; await decide({ kind: "close", topic: t.id, reopen: el.dataset.close }); });
  on("[data-act=reopen]", () => decide({ kind: "reopen", topic: t.id }));
  on("[data-colour]", (el) => { root.querySelectorAll(".swatch").forEach((s) => s.classList.toggle("on", s === el)); });
  on("[data-act=save-edit]", async () => {
    const name = root.querySelector("#ed-name").value.trim();
    const colour = root.querySelector(".swatch.on")?.dataset.colour;
    const area = root.querySelector("#ed-area").value;
    panel = null;
    if (name && name !== t.name) await decide({ kind: "name", topic: t.id, name });
    if (colour && colour !== t.colour) await decide({ kind: "colour", topic: t.id, colour });
    if (area !== t.area) await decide({ kind: "area", topic: t.id, area });
    render(v);
  });
  on("[data-act=older]", () => { showOlder = !showOlder; render(v); });
  on("[data-dismiss]", (el) => decide({ kind: "dismiss_action", item: el.dataset.dismiss }));
  on("[data-all]", (el) => { const s = el.dataset.all; allOpen.has(s) ? allOpen.delete(s) : allOpen.add(s); render(v); });
  wireMoveSelects(root);
}

async function load() {
  let v;
  try {
    v = await api(`/api/topic/${encodeURIComponent(topicId)}`);
  } catch {
    // Merged away or gone: say so rather than showing an empty page.
    root.innerHTML = `<p>This topic isn't on the bridge any more (merged or empty). <a href="/" target="bridge-main">Back to the bridge</a></p>`;
    return;
  }
  if (firstSeen === undefined) {
    firstSeen = v.topic.seenUpTo;
    const latest = v.log[0]?.at;
    if (latest && (!firstSeen || latest > firstSeen)) decide({ kind: "seen", topic: v.topic.id, upTo: latest });
  }
  render(v);
}

load();
// ?still: no live updates, so headless Chrome can finish loading for screenshots.
if (!new URLSearchParams(location.search).has("still")) live(load);
