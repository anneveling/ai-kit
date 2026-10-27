// The ship deck, drawn in text cells: each cell is two square pixels
// stacked (an upper half block with a foreground and a background color),
// so a band of 9 rows is 18 pixels tall. Runs on the surface's frame clock.

import type { ClientModule } from 'claude-code'

import type { Scene } from '../types'
import { at, C, drawDeck, drawHumanExtras, drawMug, drawRobotExtras, H, humanRows, layoutFor, put, robotRows, sprite } from './art'
import type { Grid } from './art'

type Props = Scene & { isWorking: boolean; rows: number }
type Tick = { t: number }

const TICK_MS = 125
const LINE_TICKS = 64
const REPLY_DELAY = 10
const POKE_TICKS = 24
const BEAT_TICKS = 48

// The instance's life between frames. One band, one instance.
const cur = {
  t: 0,
  rx: -1,
  rTarget: -1,
  rDir: 1,
  robotSeen: -1,
  robotAt: -999,
  humanSeen: -1,
  humanAt: -999,
  replyAt: -999,
  beatSeen: -1,
  beatKind: '',
  beatAt: -999,
  scoreSeen: -1,
  scoreAt: -999,
  poke: null as null | { who: 'robot' | 'human'; text: string; at: number },
  confetti: [] as { x: number; y: number; v: number; c: string }[],
  robotHit: { x0: 0, x1: 0, row: 0 },
  humanHit: { x0: 0, x1: 0, row: 0 },
}

const ROBOT_POKES = ['Hey!', 'Personal space!', 'Boop.', "I'm working here.", 'Do that again. I dare you.']
const HUMAN_POKES = ['That tickles.', "Don't poke the user.", 'Who, me?', 'Rude.']

type Cell = { ch: string; fg: string; bg: string }

// ── Text over the pixels ───────────────────────────────────────────────────

const write = (ov: Map<string, Cell>, g: Grid, row: number, col: number, text: string, fg: string, bg?: string) => {
  ;[...text].forEach((ch, i) => {
    const x = col + i
    if (x < 0 || x >= (g[0]?.length ?? 0)) return
    ov.set(`${row},${x}`, { ch, fg, bg: bg ?? at(g, x, row * 2) })
  })
}

const clip = (text: string, n: number) => (text.length > n ? text.slice(0, Math.max(0, n - 1)) + '…' : text)

const balloon = (
  ov: Map<string, Cell>,
  g: Grid,
  text: string,
  isMumble: boolean,
  anchor: number,
  side: 'left' | 'right',
  room: number,
) => {
  const body = clip(text, room - 2)
  const w = body.length + 2
  const cols = g[0]?.length ?? 0
  const start = side === 'left' ? Math.max(0, anchor - 1) : Math.max(0, Math.min(cols - w, anchor - w + 2))
  if (isMumble) {
    write(ov, g, 1, start, ` ${body} `, C.lgray, '#1A1A1A')
    put(g, anchor + 4, 4, C.lgray)
    put(g, anchor + 5, 5, C.dgray)
    return
  }
  write(ov, g, 1, start, ` ${body} `, C.black, C.white)
  const tail = side === 'left' ? anchor + 4 : anchor - 1
  put(g, tail, 4, C.white)
  put(g, tail + (side === 'left' ? 1 : -1), 5, C.white)
}

const statusBar = (ov: Map<string, Cell>, g: Grid, p: Props, t: number, cols: number) => {
  const left = ` Claude: ${p.robot.mood}`
  const right = `You: ${p.human.mood} `
  const center = `Score: ${p.score} of 202`
  const bar = new Array<string>(cols).fill(' ')
  const place = (s: string, x: number) => [...s].forEach((ch, i) => (bar[x + i] = ch))
  place(left, 0)
  place(right, Math.max(left.length + 1, cols - right.length))
  const cx = Math.floor((cols - center.length) / 2)
  if (cx > left.length + 1 && cx + center.length < cols - right.length - 1) place(center, cx)
  const isFlash = t - cur.scoreAt < 16
  bar.slice(0, cols).forEach((ch, x) => {
    const inScore = x >= cx && x < cx + center.length
    const flash = isFlash && inScore && t % 4 < 2
    ov.set(`0,${x}`, { ch, fg: flash ? C.black : C.lgray, bg: flash ? C.yellow : C.black })
  })
}

// ── The frame ──────────────────────────────────────────────────────────────

const Deck: ClientModule<Props, Tick> = (p, surface) => {
  const { Box, Text } = surface.elements
  if (surface.state === undefined) {
    cur.t = 0
    cur.rx = -1
    cur.robotSeen = p.robot.line?.id ?? -1
    cur.humanSeen = p.human.line?.id ?? -1
    cur.beatSeen = p.beat?.id ?? -1
    cur.scoreSeen = p.score
    cur.robotAt = cur.humanAt = cur.beatAt = cur.scoreAt = -999
    cur.poke = null
    surface.every(TICK_MS, () => {
      cur.t += 1
      surface.setState({ t: cur.t })
    })
    surface.onPointer(ev => {
      if (ev.type !== 'down') return
      const hit = (b: { x0: number; x1: number; row: number }) => ev.x >= b.x0 && ev.x <= b.x1 && ev.y >= b.row
      if (hit(cur.robotHit)) cur.poke = { who: 'robot', text: ROBOT_POKES[cur.t % ROBOT_POKES.length]!, at: cur.t }
      else if (hit(cur.humanHit)) cur.poke = { who: 'human', text: HUMAN_POKES[cur.t % HUMAN_POKES.length]!, at: cur.t }
    })
  }

  const cols = surface.columns
  const rows = Math.max(1, p.rows)
  if (cols <= 0) return <Box height={rows} />
  const t = cur.t
  const g: Grid = Array.from({ length: H }, () => new Array<string>(cols).fill(C.dgray))
  const ov = new Map<string, Cell>()

  // What changed since the last frame: new lines, beats, points.
  if (p.human.line && p.human.line.id !== cur.humanSeen) {
    cur.humanSeen = p.human.line.id
    cur.humanAt = t
  }
  if (p.robot.line && p.robot.line.id !== cur.robotSeen) {
    cur.robotSeen = p.robot.line.id
    cur.robotAt = p.robot.line.isReply ? t + REPLY_DELAY : t
  }
  if (p.beat && p.beat.id !== cur.beatSeen) {
    cur.beatSeen = p.beat.id
    cur.beatKind = p.beat.kind
    cur.beatAt = t
    if (p.beat.kind === 'celebrate')
      cur.confetti = Array.from({ length: Math.max(20, Math.round(cols / 2)) }, (_, i) => ({
        x: Math.random() * cols,
        y: -Math.random() * 16,
        v: 0.3 + Math.random() * 0.4,
        c: [C.lmagenta, C.yellow, C.lgreen, C.lcyan, C.lred][i % 5]!,
      }))
  }
  if (p.score !== cur.scoreSeen) {
    if (cur.scoreSeen >= 0) cur.scoreAt = t
    cur.scoreSeen = p.score
  }

  if (rows < 9) {
    statusBar(ov, g, p, t, cols)
    return toTree(Box, Text, g, ov, cols, 1)
  }

  const layout = layoutFor(cols)
  drawDeck(g, p, t, cols, layout, { flash: cur.beatKind === 'esc' && t - cur.beatAt < 8 })

  // The robot moves only when its mood means it.
  const mood = p.robot.mood
  if (cur.rx < 0) cur.rx = layout.home
  if (mood === 'frustrated') {
    cur.rx += cur.rDir * 0.5
    if (cur.rx > layout.home + 10 || cur.rx < layout.home - 3) cur.rDir *= -1
  } else {
    if (mood === 'bored' && t % 64 === 0) cur.rTarget = layout.home + ((t / 64) % 2 ? 4 : -2)
    if (mood !== 'bored') cur.rTarget = layout.home
    const d = cur.rTarget - cur.rx
    if (Math.abs(d) > 0.3) cur.rx += Math.sign(d) * 0.34
  }
  cur.rx = Math.max(1, Math.min(cols - 14, cur.rx))
  const isWalking = mood === 'frustrated' || Math.abs(cur.rTarget - cur.rx) > 0.3
  const poked = cur.poke && t - cur.poke.at < POKE_TICKS ? cur.poke : null
  const hop = (who: 'robot' | 'human') => (poked?.who === who && t - poked.at < 4 ? -2 : 0)
  const jump = (isOn: boolean) => (isOn ? -[0, 1, 2, 1][t % 4]! : 0)

  const rRows = robotRows(mood, t, isWalking, p.isWorking)
  const rx = Math.round(cur.rx)
  const ry = 16 - rRows.length + jump(mood === 'celebrating') + hop('robot')
  sprite(g, rRows, rx, ry)
  cur.robotHit = { x0: rx - 1, x1: rx + 11, row: Math.floor(ry / 2) }

  const hMood = p.human.mood
  const hRows = humanRows(hMood, t)
  const hx = layout.hx + (hMood === 'amused' && t % 24 < 6 ? (t % 2 ? 1 : -1) : 0)
  const hy = 16 - hRows.length + jump(hMood === 'celebrating') + hop('human') + (hMood === 'happy' && t % 40 < 3 ? -1 : 0)
  if (hMood !== 'away') sprite(g, hRows, hx, hy)
  cur.humanHit = { x0: hx - 1, x1: hx + 9, row: Math.floor(hy / 2) }

  // Little extras around the characters.
  drawRobotExtras(g, mood, rx, ry, t)
  drawHumanExtras(g, hMood, hx, hy, t)
  if (cur.beatKind === 'coffee' && t - cur.beatAt < BEAT_TICKS) drawMug(g, rx, t)

  if (t - cur.beatAt < BEAT_TICKS && cur.beatKind === 'celebrate')
    for (const c of cur.confetti) {
      c.y += c.v
      c.x += Math.sin(c.y + c.x) * 0.3
      if (c.y > 15) c.y = -1
      put(g, Math.round(c.x), Math.round(c.y), c.c)
    }

  // Text: status bar, z's, question marks, balloons.
  statusBar(ov, g, p, t, cols)
  const zRow = Math.max(2, Math.floor(ry / 2) - 1)
  if (mood === 'asleep') write(ov, g, zRow, rx + 11 + (t % 16 < 8 ? 0 : 1), t % 16 < 8 ? 'z' : 'Z', C.white)
  if (hMood === 'asleep') write(ov, g, Math.max(2, Math.floor(hy / 2) - 1), hx + 8, t % 16 < 8 ? 'z' : 'Z', C.white)
  if (hMood === 'away') write(ov, g, 6, hx + 2, ' BRB ', C.black, C.yellow)
  if (hMood === 'curious' && t % 16 < 12) write(ov, g, Math.max(2, Math.floor(hy / 2) - 1), hx + 4, '?', C.yellow)

  const room = Math.max(8, Math.floor(cols / 2) - 2)
  const humanText =
    poked?.who === 'human'
      ? poked.text
      : p.human.line && t - cur.humanAt < LINE_TICKS
        ? p.human.line.text
        : null
  const robotLine =
    poked?.who === 'robot'
      ? { text: poked.text, isMumble: false }
      : p.robot.line && t >= cur.robotAt && t - cur.robotAt < LINE_TICKS
        ? p.robot.line
        : null
  if (humanText) balloon(ov, g, humanText, false, hx + 2, 'right', room)
  if (robotLine) balloon(ov, g, robotLine.text, robotLine.isMumble, rx, 'left', room)

  return toTree(Box, Text, g, ov, cols, 9)
}

// Pixels and text to rows of runs: one Text per stretch of one style.
const toTree = (
  Box: Parameters<ClientModule>[1]['elements']['Box'],
  Text: Parameters<ClientModule>[1]['elements']['Text'],
  g: Grid,
  ov: Map<string, Cell>,
  cols: number,
  rows: number,
) => {
  const lines: { text: string; fg: string; bg: string }[][] = []
  for (let r = 0; r < rows; r++) {
    const runs: { text: string; fg: string; bg: string }[] = []
    for (let x = 0; x < cols; x++) {
      const o = ov.get(`${r},${x}`)
      const top = at(g, x, r * 2)
      const bottom = at(g, x, r * 2 + 1)
      const cell = o ?? (top === bottom ? { ch: ' ', fg: '', bg: top } : { ch: '▀', fg: top, bg: bottom })
      const last = runs[runs.length - 1]
      if (last && last.fg === cell.fg && last.bg === cell.bg) last.text += cell.ch
      else runs.push({ text: cell.ch, fg: cell.fg, bg: cell.bg })
    }
    lines.push(runs)
  }
  return (
    <Box flexDirection="column" width={cols} height={rows}>
      {lines.map(runs => (
        <Box flexDirection="row" height={1}>
          {runs.map(run => (
            <Text color={run.fg || undefined} backgroundColor={run.bg} wrap="truncate">
              {run.text}
            </Text>
          ))}
        </Box>
      ))}
    </Box>
  )
}

export default Deck
