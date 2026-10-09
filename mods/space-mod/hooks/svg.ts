// The deck for the desktop: one SVG of square pixels. Everything that moves
// runs inside it as SMIL animation (a flipbook per character, the stars, the
// lights), so the band is redrawn only when a mood or a line changes.

import type { Scene } from '../types'
import {
  C,
  drawDeck,
  drawHumanExtras,
  drawMug,
  drawRobotExtras,
  grid,
  H,
  hash,
  humanRows,
  layoutFor,
  robotRows,
  sprite,
} from './art'
import type { Grid } from './art'

export type DeskScene = Scene & { isWorking: boolean }

const PX = 8 // CSS pixels per art pixel
const CELL = 7.8 // CSS pixels per column on the desktop, about
const TOP = 3 // the status bar, in art pixels
const FRAMES = 48
const FRAME_S = 0.125
const LOOP = `${FRAMES * FRAME_S}s`
const LINE_S = 8
const REPLY_S = 1.2
const BEAT_S = 6
const FONT = 'font-family="Menlo, Monaco, Consolas, monospace"'

const escape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const n = (v: number) => String(Math.round(v * 100) / 100)

/** A grid as one path per color: each run of a row is `M x y h len v1 h -len z`. */
const paths = (g: Grid, ox = 0, oy = 0) => {
  const byColor = new Map<string, string[]>()
  g.forEach((row, y) => {
    let x = 0
    while (x < row.length) {
      const c = row[x]
      if (!c) {
        x++
        continue
      }
      let e = x + 1
      while (e < row.length && row[e] === c) e++
      const d = byColor.get(c) ?? []
      d.push(`M${ox + x} ${oy + y}h${e - x}v1h-${e - x}z`)
      byColor.set(c, d)
      x = e
    }
  })
  return [...byColor].map(([c, d]) => `<path fill="${c}" d="${d.join('')}"/>`).join('')
}

/** Frames as a flipbook: each distinct frame once, shown on its own ticks. */
const flipbook = (frames: string[]) => {
  const unique = [...new Set(frames)]
  if (unique.length === 1) return unique[0] ?? ''
  const keyTimes = frames.map((_, i) => n(i / frames.length)).join(';')
  return unique
    .map(f => {
      const values = frames.map(x => (x === f ? 1 : 0)).join(';')
      return `<g opacity="${frames[0] === f ? 1 : 0}"><animate attributeName="opacity" values="${values}" keyTimes="${keyTimes}" calcMode="discrete" dur="${LOOP}" repeatCount="indefinite"/>${f}</g>`
    })
    .join('')
}

/** Shown from `from` to `until` seconds after the drawing starts. */
const during = (from: number, until: number, body: string) => {
  const show = from > 0 ? `<set attributeName="visibility" to="visible" begin="${n(from)}s"/>` : ''
  return `<g visibility="${from > 0 ? 'hidden' : 'visible'}">${show}<set attributeName="visibility" to="hidden" begin="${n(until)}s"/>${body}</g>`
}

const textWidth = (chars: number, size: number) => chars * size * 0.6

/** Words onto at most two lines of `max` characters; an ellipsis if it still doesn't fit. */
export const wrap = (text: string, max: number, lines = 2) => {
  const out: string[] = []
  let line = ''
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word
    if (next.length <= max) line = next
    else {
      if (line) out.push(line)
      line = word.length > max ? word.slice(0, max) : word
    }
  }
  if (line) out.push(line)
  if (out.length <= lines) return out
  const kept = out.slice(0, lines)
  const last = kept[lines - 1] ?? ''
  kept[lines - 1] = (last.length < max ? last : last.slice(0, max - 1)) + '…'
  return kept
}

/**
 * A balloon inside its own lane (`lane0`..`lane1`), hugging its speaker:
 * the robot's grows right from its left edge, the human's left from its
 * right edge, so the two never meet.
 */
const balloon = (text: string, isMumble: boolean, lane0: number, lane1: number, tail: number, side: 'left' | 'right') => {
  const size = 2
  const lead = 2.5
  const max = Math.max(6, Math.floor((lane1 - lane0 - 2) / (size * 0.6)))
  const lines = wrap(isMumble ? `∘ ${text}` : text, max)
  const longest = Math.max(...lines.map(l => l.length))
  const bw = textWidth(longest, size) + 2
  const bh = lines.length * lead + 1
  const x = side === 'left' ? lane0 : lane1 - bw
  const y = TOP + 0.5
  const fill = isMumble ? '#1A1A1A' : C.white
  const ink = isMumble ? C.lgray : C.black
  const tailY = Math.ceil(y + bh)
  const tailPx = isMumble
    ? `<rect x="${tail}" y="${tailY}" width="1" height="1" fill="${C.lgray}"/>`
    : `<rect x="${tail}" y="${tailY}" width="1" height="1" fill="${fill}"/><rect x="${tail + (side === 'left' ? 1 : -1)}" y="${tailY + 1}" width="1" height="1" fill="${fill}"/>`
  const texts = lines
    .map(
      (l, i) =>
        `<text x="${n(x + 1)}" y="${n(y + 0.5 + size + i * lead)}" font-size="${size}" ${FONT} fill="${ink}" textLength="${n(textWidth(l.length, size))}" lengthAdjust="spacingAndGlyphs">${escape(l)}</text>`,
    )
    .join('')
  return `<rect x="${n(x)}" y="${y}" width="${n(bw)}" height="${n(bh)}" fill="${fill}"/>` + tailPx + texts
}

export const deckSvg = (p: DeskScene, now: number, bodyColumns: number) => {
  // As wide as the band, in art pixels of PX screen pixels each.
  const W = Math.max(64, Math.min(240, Math.round((bodyColumns * CELL) / PX)))
  const layout = layoutFor(W)
  const out: string[] = []
  const age = (at: number) => (now - at) / 1000

  // The deck, still.
  const deck = grid(W)
  drawDeck(deck, p, 0, W, layout, { isStill: true })
  out.push(paths(deck, 0, TOP))

  // Stars drifting past the window, the planet in front of them.
  const { wx0, wx1, cx0 } = layout
  if (wx1 - wx0 > 8) {
    const span = wx1 - wx0 - 1
    const stars = grid(span * 2, H)
    for (let y = 3; y <= 9; y++)
      for (let x = 0; x < span * 2; x++) {
        const h = hash((x % span) + 1000, y)
        if (h % 29 === 0) stars[y]![x] = C.white
        else if (h % 53 === 1) stars[y]![x] = C.lblue
      }
    const step = p.sky === 'alert' ? 0.125 : p.sky === 'tense' ? 0.375 : 1
    const values = Array.from({ length: span }, (_, i) => `${-i} 0`).join(';')
    out.push(
      `<clipPath id="win"><rect x="${wx0 + 1}" y="${TOP + 3}" width="${span}" height="7"/></clipPath>` +
        `<g clip-path="url(#win)"><g><animateTransform attributeName="transform" type="translate" values="${values}" calcMode="discrete" dur="${n(span * step)}s" repeatCount="indefinite"/>${paths(stars, wx0 + 1, TOP)}</g></g>`,
    )
    const front = grid(W)
    for (let y = 3; y <= 9; y++)
      for (let x = wx0 + 1; x < wx1; x++) {
        const c = deck[y]?.[x]
        if (c && c !== C.black) front[y]![x] = c
      }
    out.push(paths(front, 0, TOP))
  }

  // Red alert, and the console's blinking lights.
  if (p.sky === 'alert') {
    const blink = `<animate attributeName="fill" values="${C.red};${C.lred}" calcMode="discrete" dur="1s" repeatCount="indefinite"/>`
    const segments = wx1 > wx0 ? [[0, wx0], [wx1 + 1, W]] : [[0, W]]
    for (const [a, b] of segments) out.push(`<rect x="${a}" y="${TOP + 5}" width="${b! - a!}" height="1" fill="${C.red}">${blink}</rect>`)
  }
  if (cx0 > 0)
    for (let x = cx0 + 2; x < cx0 + 10; x += 2) {
      const k = (x / 2) % 3
      const cs = [C.lred, C.lgreen, C.yellow]
      const values = [0, 1, 2].map(i => cs[(i + k) % 3]).join(';')
      out.push(`<rect x="${x}" y="${TOP + 8}" width="1" height="1" fill="${cs[k]}"><animate attributeName="fill" values="${values}" calcMode="discrete" dur="1.125s" repeatCount="indefinite"/></rect>`)
    }

  // The robot: a flipbook of its mood, pacing when it means it.
  const mood = p.robot.mood
  const rx = layout.home
  const isPacing = mood === 'frustrated'
  const robotFrames: string[] = []
  for (let t = 0; t < FRAMES; t++) {
    const g = grid(18, H)
    const rows = robotRows(mood, t, isPacing, p.isWorking)
    const jump = mood === 'celebrating' ? -[0, 1, 2, 1][t % 4]! : 0
    const ry = 16 - rows.length + jump
    sprite(g, rows, 2, ry)
    drawRobotExtras(g, mood, 2, ry, t)
    robotFrames.push(paths(g, rx - 2, TOP))
  }
  const pace = isPacing
    ? `<animateTransform attributeName="transform" type="translate" values="${[...Array.from({ length: 12 }, (_, i) => i), ...Array.from({ length: 12 }, (_, i) => 12 - i)].map(v => `${v} 0`).join(';')}" calcMode="discrete" dur="6s" repeatCount="indefinite"/>`
    : ''
  out.push(`<g>${pace}${flipbook(robotFrames)}</g>`)
  if (mood === 'asleep') out.push(`<text x="${rx + 11}" y="${TOP + 9}" font-size="2.6" ${FONT} fill="${C.white}">z<animate attributeName="y" values="${TOP + 9};${TOP + 7};${TOP + 9}" dur="2s" repeatCount="indefinite"/></text>`)

  // The human.
  const hMood = p.human.mood
  const hx = layout.hx
  const humanFrames: string[] = []
  for (let t = 0; t < FRAMES; t++) {
    const g = grid(16, H)
    const rows = humanRows(hMood, t)
    const jump = hMood === 'celebrating' ? -[1, 2, 1, 0][t % 4]! : hMood === 'happy' && t % 40 < 3 ? -1 : 0
    const dx = hMood === 'amused' && t % 24 < 6 ? (t % 2 ? 1 : -1) : 0
    const hy = 16 - rows.length + jump
    sprite(g, rows, 2 + dx, hy)
    drawHumanExtras(g, hMood, 2 + dx, hy, t)
    humanFrames.push(paths(g, hx - 2, TOP))
  }
  out.push(flipbook(humanFrames))
  if (hMood === 'asleep') out.push(`<text x="${hx + 8}" y="${TOP + 5}" font-size="2.6" ${FONT} fill="${C.white}">z<animate attributeName="opacity" values="1;0.2;1" dur="2s" repeatCount="indefinite"/></text>`)
  if (hMood === 'curious') out.push(`<text x="${hx + 3.5}" y="${TOP + 5}" font-size="2.6" ${FONT} fill="${C.yellow}">?</text>`)

  // Beats: coffee and confetti, for as long as they last.
  if (p.beat && age(p.beat.at) < BEAT_S) {
    const left = BEAT_S - age(p.beat.at)
    if (p.beat.kind === 'coffee') {
      const mug = Array.from({ length: 2 }, (_, t) => {
        const g = grid(W)
        drawMug(g, rx, t)
        return paths(g, 0, TOP)
      })
      out.push(during(0, left, flipbook([...Array(FRAMES)].map((_, i) => mug[i % 2]!))))
    }
    if (p.beat.kind === 'celebrate') {
      const bits = Array.from({ length: Math.round(W / 3) }, (_, i) => {
        const x = hash(i, 7) % W
        const c = [C.lmagenta, C.yellow, C.lgreen, C.lcyan, C.lred][i % 5]
        const d = 1.5 + (hash(i, 3) % 10) / 10
        return `<rect x="${x}" y="${TOP}" width="1" height="1" fill="${c}"><animate attributeName="y" values="${TOP - 1};${TOP + 17}" dur="${n(d)}s" begin="-${n((hash(i, 5) % 15) / 10)}s" repeatCount="indefinite"/></rect>`
      })
      out.push(during(0, left, bits.join('')))
    }
  }

  // The status bar, Sierra style.
  const size = 2.2
  out.push(
    `<rect x="0" y="0" width="${W}" height="${TOP}" fill="${C.white}"/>` +
      `<text x="1" y="2.25" font-size="${size}" ${FONT} fill="${C.black}">Claude: ${mood}</text>` +
      `<text x="${W / 2}" y="2.25" font-size="${size}" ${FONT} fill="${C.black}" text-anchor="middle">Score: ${p.score} of 202</text>` +
      `<text x="${W - 1}" y="2.25" font-size="${size}" ${FONT} fill="${C.black}" text-anchor="end">You: ${hMood}</text>`,
  )

  // Balloons, each for its last few seconds.
  const mid = W / 2
  const said: string[] = []
  const h = p.human.line
  if (h && age(h.at) < LINE_S) {
    said.push(h.text)
    out.push(during(0, LINE_S - age(h.at), balloon(h.text, false, mid + 1, Math.min(W - 1, hx + 11), hx + 1, 'right')))
  }
  const r = p.robot.line
  const rDelay = r?.isReply ? REPLY_S : 0
  if (r && age(r.at) < LINE_S + rDelay) {
    said.push(r.text)
    out.push(during(Math.max(0, rDelay - age(r.at)), LINE_S + rDelay - age(r.at), balloon(r.text, r.isMumble, Math.max(1, rx - 1), mid - 1, rx + 4, 'left')))
  }

  const height = H + TOP
  const source =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${height}" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" style="background:${C.black}" shape-rendering="crispEdges">` +
    out.join('') +
    '</svg>'
  const alt = `Claude is ${mood}, you are ${hMood}. Score ${p.score} of 202.${said.length ? ` "${said.join('" "')}"` : ''}`
  return { source, alt, width: W * PX, height: height * PX }
}
