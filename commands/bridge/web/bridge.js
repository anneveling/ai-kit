// The bridge: an overview, no actions except sorting New. Every topic opens its own tab.

const root = document.getElementById("root");

function hotCol(t, now, cls, withArea = true) {
  return `<div class="${cls}" style="--c:${esc(t.colour)}">
    ${withArea ? `<span class="label">${esc(t.area)}</span>` : ""}
    <div class="ttl"><span class="sq"></span>${esc(t.name)}</div>
    <div class="what">${esc(t.line)}</div>
    <div class="ball"><b class="${ballClass(t)}">${esc(t.ball)}</b> <span class="muted">· ${ago(t.since, now)}</span>
      &nbsp; <button class="link" data-open="${esc(t.id)}">Open</button></div>
  </div>`;
}

function hotHtml(v) {
  if (v.hot.length === 0 && v.loading) {
    return `<div class="allquiet"><div class="big muted">Looking at the sources…</div></div>`;
  }
  if (v.hot.length === 0) {
    const q = v.quiet;
    return `<div class="allquiet"><div class="big">All quiet on the bridge</div>
      <div class="muted">${q ? `${q.inMotion} in motion · ${q.waiting} waiting` : ""}</div></div>`;
  }
  if (!v.hotSplit) {
    return `<div class="hot">${v.hot.map((t) => hotCol(t, v.now, "col")).join("")}</div>`;
  }
  // Hot topics span areas: one side per area, so you see where the pressure is.
  const areas = v.areas.filter((a) => v.hot.some((t) => t.area === a));
  return `<div class="hot split" style="--n:${areas.length}">${areas.map((area) => `<div class="col">
      <div class="side-h">${esc(area)}</div>
      ${v.hot.filter((t) => t.area === area).map((t) => hotCol(t, v.now, "hotline", false)).join("")}
    </div>`).join("")}</div>`;
}

function newHtml(v) {
  if (v.newItems.length === 0) return "";
  return `<div class="label group-h">New · not sorted</div><div class="rows">${v.newItems.map((i) => `
    <div class="r">
      <span class="name"><span class="muted" style="margin-right:7px">?</span><span>${i.url ? `<a href="${esc(i.url)}" target="_blank" rel="noopener">${esc(i.title)}</a>` : esc(i.title)}</span></span>
      <span class="what"><span class="dot ${i.state} ${i.state === "your_move" ? "yellow" : ""}">${i.state === "quiet" ? "○" : "●"}</span>${esc(i.line)}</span>
      <span class="since">${ago(i.since, v.now)}</span>
      <span class="sorter"><button class="link" data-sort="${esc(i.id)}">Sort</button></span>
    </div>`).join("")}</div>`;
}

function tableHtml(v) {
  return v.groups.map((g) => `<div class="label group-h">${esc(g.area)}</div><div class="rows">${g.topics.map((t) => `
    <div class="r" style="--c:${esc(t.colour)}">
      <span class="name"><span class="sq"></span><span>${esc(t.name)}</span></span>
      <span class="what">${t.snoozedUntil
        ? `<span class="muted">Snoozed until ${esc(whenLabel(t.snoozedUntil))}</span>`
        : `<span class="dot ${t.state} ${t.alert ?? ""}">${t.state === "quiet" ? "○" : "●"}</span>${esc(t.line)}`}</span>
      <span class="since">${ago(t.since, v.now)}</span>
      <button class="link" data-open="${esc(t.id)}">Open</button>
    </div>`).join("")}</div>`).join("");
}

async function load() {
  const v = await api("/api/bridge");
  const done = v.doneCount ? `<div class="sm muted" style="margin-top:18px">${v.doneCount} topic${v.doneCount === 1 ? "" : "s"} done in the last 14 days</div>` : "";
  root.innerHTML = headerHtml(v, "Bridge") + hotHtml(v) + `<hr>` + newHtml(v) + tableHtml(v) + done;
  root.querySelectorAll("[data-open]").forEach((b) => b.addEventListener("click", () => openTopic(b.dataset.open)));
  root.querySelectorAll("[data-sort]").forEach((b) => b.addEventListener("click", () => {
    b.parentElement.innerHTML = moveSelect(b.dataset.sort, v.openTopics);
    wireMoveSelects(root);
  }));
}

load();
// ?still: no live updates, so headless Chrome can finish loading for screenshots.
if (!new URLSearchParams(location.search).has("still")) live(load);
