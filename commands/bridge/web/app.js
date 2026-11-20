// Shared helpers for both pages. Plain JS: the browser doesn't run TypeScript.

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

async function api(path) {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

/** Post a decision; the server stamps the time. Returns true when it was written. */
async function decide(decision) {
  const res = await fetch("/decide", { method: "POST", body: JSON.stringify(decision) });
  if (!res.ok) { alert(`Not saved: ${await res.text()}`); return false; }
  return true;
}

/** How long ago, relative to the view's own clock (the demo runs on a fixed one). */
function ago(iso, nowIso) {
  if (!iso) return "";
  const min = Math.max(0, Math.round((Date.parse(nowIso) - Date.parse(iso)) / 60000));
  if (min < 60) return `${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h`;
  return `${Math.round(h / 24)} d`;
}

const hhmm = (iso) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });

function dayLabel(iso, nowIso) {
  const d = new Date(iso); const n = new Date(nowIso);
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(n) - day(d)) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return d.toLocaleDateString([], { weekday: "long", day: "numeric", month: "short" });
}

function whenLabel(iso) {
  return new Date(iso).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false });
}

/** One named tab per topic, so a second click reuses it. */
function openTopic(id) {
  window.open(`/t/${encodeURIComponent(id)}`, `bridge-topic-${id}`);
}

const ballClass = (t) => (t.alert === "red" ? "red" : t.alert === "yellow" ? "amber" : "muted");

function headerHtml(view, title) {
  const bad = view.health.filter((h) => !h.ok);
  const starting = (h) => !h.lastOk && h.message === "starting…";
  const health = bad.length
    ? bad.map((h) => `<span class="${starting(h) ? "" : "bad"}">${esc(h.source)}: ${esc(h.message ?? "offline")}${h.lastOk ? ` · last ok ${hhmm(h.lastOk)}` : ""}</span>`).join(" · ")
    : `All sources fine${view.health[0]?.lastOk ? ` · updated ${hhmm(view.health[0].lastOk)}` : ""}`;
  return `<header class="top"><h1>${title}</h1><div class="health">${health}</div></header>` +
    (view.problems.length ? `<div class="problems">${view.problems.map(esc).join("<br>")}</div>` : "");
}

/** Reload on every change the server pushes. */
function live(load) {
  const source = new EventSource("/events");
  source.onmessage = () => load().catch((e) => console.error(e));
  source.onerror = () => {}; // EventSource reconnects by itself
}

function slug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "topic";
}

/** A "belongs to…" select: move to an open topic, or split off into its own. */
function moveSelect(itemId, openTopics, placeholder = "belongs to…") {
  return `<select data-move="${esc(itemId)}"><option value="">${esc(placeholder)}</option>` +
    openTopics.map((t) => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join("") +
    `<option value="__own">its own topic…</option></select>`;
}

function wireMoveSelects(root) {
  root.querySelectorAll("select[data-move]").forEach((sel) => {
    sel.addEventListener("change", async () => {
      const item = sel.dataset.move;
      if (!sel.value) return;
      if (sel.value === "__own") {
        const name = prompt("Name of the new topic");
        if (!name) { sel.value = ""; return; }
        await decide({ kind: "split", item, id: `${slug(name)}-${Date.now().toString(36).slice(-4)}`, name });
      } else {
        await decide({ kind: "move", item, to: sel.value });
      }
    });
  });
}
