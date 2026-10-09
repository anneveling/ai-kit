// The art both surfaces draw: palette, sprites and the deck, as pixels on a
// grid of colors. The terminal turns the grid into text cells; the desktop
// into an SVG.

import type { HumanMood, RobotMood, Sky } from '../types'

export const H = 18

export type Grid = string[][]

export const grid = (w: number, h = H, fill = '') => Array.from({ length: h }, () => new Array<string>(w).fill(fill))

// The EGA palette, plus Claude's orange.
export const C = {
  black: '#000000',
  blue: '#0000AA',
  cyan: '#00AAAA',
  red: '#AA0000',
  brown: '#AA5500',
  lgray: '#AAAAAA',
  dgray: '#555555',
  lblue: '#5555FF',
  lcyan: '#55FFFF',
  lred: '#FF5555',
  lmagenta: '#FF55FF',
  lgreen: '#55FF55',
  yellow: '#FFFF55',
  white: '#FFFFFF',
  claude: '#E8805A',
  nightWall: '#3A3A3A',
  nightSeam: '#1E1E1E',
}

export const PAL: Record<string, string> = {
  O: C.claude,
  K: C.black,
  H: '#7A3D00',
  S: '#FFAA77',
  G: C.black,
  B: C.brown,
  T: C.lgray,
  Y: C.yellow,
  P: '#8A8A8A',
  W: C.white,
  D: C.dgray,
  L: C.lgray,
  C: C.lcyan,
}

export const put = (g: Grid, x: number, y: number, c: string) => {
  const row = g[y]
  if (row && x >= 0 && x < row.length) row[x] = c
}
export const at = (g: Grid, x: number, y: number) => g[y]?.[x] ?? C.black
export const hash = (x: number, y: number) => (((x * 73856093) ^ (y * 19349663)) >>> 0) % 1009

export const sprite = (g: Grid, rows: readonly string[], ox: number, oy: number) => {
  const on = (r: number, c: number) => {
    const ch = rows[r]?.[c]
    return ch !== undefined && ch !== '.'
  }
  const w = Math.max(...rows.map(r => r.length))
  for (let r = -1; r <= rows.length; r++)
    for (let c = -1; c <= w; c++)
      if (!on(r, c) && (on(r - 1, c) || on(r + 1, c) || on(r, c - 1) || on(r, c + 1))) put(g, ox + c, oy + r, C.black)
  rows.forEach((row, r) =>
    [...row].forEach((ch, c) => {
      if (ch !== '.') put(g, ox + c, oy + r, PAL[ch] ?? C.white)
    }),
  )
}

// ── The robot: Claude's little orange creature ─────────────────────────────

export const robotRows = (mood: RobotMood, t: number, isWalking: boolean, isWorking: boolean) => {
  const blink = t % 44 < 2
  let eyes = ['..OKOOOKO..', '..OKOOOKO..']
  if (mood === 'waiting') eyes = ['..OOKOOOK..', '..OOKOOOK..']
  if (mood === 'bored') eyes = Math.floor(t / 16) % 2 ? ['..OOKOOOK..', '..OOKOOOK..'] : ['..KOOOKOO..', '..KOOOKOO..']
  if (mood === 'sulky') eyes = ['..OOOOOOO..', '..OKOOOKO..']
  if (blink || mood === 'asleep' || (mood === 'sleepy' && t % 24 < 12)) eyes = ['..OOOOOOO..', '..OKKOKKO..']

  const armsUp = mood === 'celebrating' || (mood === 'proud' && t % 32 < 10)
  const legs = isWalking
    ? Math.floor(t / 2) % 2
      ? '.O.O...O.O.'
      : '..O.O.O.O..'
    : mood === 'waiting' && t % 6 < 3
      ? '..O.O.O....'
      : '..O.O.O.O..'

  let rows = [
    armsUp ? 'O....A....O' : '.....A.....',
    armsUp ? 'O.OOOOOOO.O' : '..OOOOOOO..',
    ...eyes,
    armsUp ? '..OOOOOOO..' : 'OOOOOOOOOOO',
    '..OOOOOOO..',
    legs,
  ]
  if (mood === 'sulky') rows = rows.filter((_, i) => i !== 1)
  if (mood === 'startled') rows = [...rows].reverse()
  // The antenna light blinks while working.
  const light = isWorking ? (t % 6 < 3 ? 'Y' : 'D') : 'D'
  return rows.map(r => r.replace('A', light))
}

/** Steam when frustrated or startled, a rain cloud when sulky. */
export const drawRobotExtras = (g: Grid, mood: RobotMood, rx: number, ry: number, t: number) => {
  if (mood === 'frustrated' || mood === 'startled') {
    const f = Math.floor(t / 2) % 3
    put(g, rx + 3 + f, ry - 2 - (f % 2), C.white)
    put(g, rx + 7 - f, ry - 1 - (f % 2), C.lgray)
  }
  if (mood === 'sulky') {
    for (let x = rx + 2; x <= rx + 8; x++) put(g, x, ry - 4, C.lgray)
    for (let x = rx + 3; x <= rx + 7; x++) put(g, x, ry - 5, C.lgray)
    put(g, rx + 3 + (t % 4), ry - 3 + (t % 2), C.lblue)
    put(g, rx + 7 - (t % 3), ry - 2, C.lblue)
  }
}

/** The coffee after a compaction. */
export const drawMug = (g: Grid, rx: number, t: number) => {
  put(g, rx + 12, 14, C.white)
  put(g, rx + 12, 15, C.white)
  put(g, rx + 13, 14, C.white)
  put(g, rx + 12, 12 + (t % 2), C.lgray)
}

// ── The human: glasses, beard, a janitor's jumpsuit ────────────────────────

export const HUMAN = [
  '...HHH...',
  '..HSSSH..',
  '..GGSGG..',
  '..SSSSS..',
  '..BBBBB..',
  '...BBB...',
  '..TTYTT..',
  '.STTTTTS.',
  '...PPP...',
  '...P.P...',
]

export const humanRows = (mood: HumanMood, t: number) => {
  const rows = [...HUMAN]
  const set = (i: number, row: string) => {
    rows[i] = row
  }
  const armsUp = () => {
    for (const i of [2, 3, 4]) set(i, 'S' + (rows[i] ?? '').slice(1, 8) + 'S')
    set(7, '..TTTTT..')
  }
  switch (mood) {
    case 'celebrating':
      armsUp()
      break
    case 'happy':
      if (t % 40 < 6) armsUp()
      break
    case 'steering':
      set(6, 'SSTTYTT..')
      set(7, '..TTTTTS.')
      break
    case 'impatient':
    case 'annoyed':
      set(6, '..SSSSS..')
      set(7, '..TTTTT..')
      if (mood === 'impatient' && t % 6 < 3) set(9, '...P.....')
      break
    case 'tired':
    case 'coffee':
      set(6, '..TTYTTW.')
      set(7, '.STTTTTSW')
      break
    case 'phone':
      // Head down, both hands on a phone.
      for (const i of [5, 4, 3, 2, 1]) set(i, HUMAN[i - 1] ?? '.........')
      set(0, '.........')
      set(6, '.STCCTS..')
      set(7, '..TTTTT..')
      break
    case 'asleep':
      for (const i of [0, 1, 2, 3, 4, 5]) set(i, '.' + (rows[i] ?? '').slice(0, 8))
      break
    default:
      break
  }
  return rows
}

/** Steam off the tired human's mug. */
export const drawHumanExtras = (g: Grid, mood: HumanMood, hx: number, hy: number, t: number) => {
  if (mood === 'tired' && t % 8 < 4) put(g, hx + 8, hy + 5 - (t % 2), C.lgray)
}

// ── The deck ───────────────────────────────────────────────────────────────

export const drawDeck = (
  g: Grid,
  p: { sky: Sky; isNight: boolean },
  t: number,
  cols: number,
  layout: Layout,
  opts: { flash?: boolean; isStill?: boolean } = {},
) => {
  const flash = opts.flash === true
  for (let y = 0; y < H; y++)
    for (let x = 0; x < cols; x++) {
      let c = p.isNight ? C.nightWall : C.dgray
      if (x % 16 === 0 || y % 5 === 0) c = p.isNight ? C.nightSeam : C.black
      if (y === 5) {
        if (p.sky === 'alert' || flash) c = opts.isStill ? C.red : t % 8 < 4 ? C.red : C.lred
        else if (p.sky === 'tense') c = C.brown
      }
      if (y === 16) c = (x + y) % 2 ? C.lgray : C.dgray
      if (y === 17) c = x % 3 === 0 ? C.black : C.dgray
      put(g, x, y, c)
    }

  const { wx0, wx1 } = layout
  if (wx1 - wx0 > 8) {
    const speed = p.sky === 'alert' ? 1 : p.sky === 'tense' ? 3 : 8
    const shift = Math.floor(t / speed)
    const px = Math.round(wx0 + (wx1 - wx0) * 0.72)
    const planet = p.sky === 'alert' ? [C.red, C.lred] : p.sky === 'tense' ? [C.brown, C.yellow] : [C.cyan, C.lcyan]
    const mid = Math.round((wx0 + wx1) / 2)
    for (let y = 2; y <= 10; y++)
      for (let x = wx0; x <= wx1; x++) {
        let c = C.black
        if (y === 2 || y === 10 || x === wx0 || x === wx1) c = C.lgray
        else if (x === mid) c = C.dgray
        else if ((x - px) ** 2 + (y - 6) ** 2 <= 7) c = (x + y) % 2 ? planet[0]! : planet[1]!
        else if (!opts.isStill) {
          const h = hash(x + shift, y)
          if (h % 29 === 0) c = C.white
          else if (h % 53 === 1) c = C.lblue
        }
        put(g, x, y, c)
      }
  }

  const { cx0 } = layout
  if (cx0 > 0) {
    for (let y = 6; y <= 10; y++)
      for (let x = cx0; x <= cx0 + 10; x++) {
        let c = C.black
        if (y === 6 || y === 10 || x === cx0 || x === cx0 + 10) c = C.lgray
        else if (y === 8 && x % 2 === 0 && !opts.isStill) c = [C.lred, C.lgreen, C.yellow][(Math.floor(t / 3) + x) % 3]!
        put(g, x, y, c)
      }
  }
}

export type Layout = { wx0: number; wx1: number; cx0: number; home: number; hx: number }

export const layoutFor = (cols: number): Layout => {
  const home = Math.max(2, Math.round(cols * 0.1))
  const hx = cols - Math.max(2, Math.round(cols * 0.1)) - 9
  const roomy = cols >= 50
  const wx0 = roomy ? Math.round(cols * 0.3) : 0
  const wx1 = roomy ? Math.round(cols * 0.64) : 0
  const cx0 = roomy && wx1 + 14 < hx - 2 ? wx1 + 3 : 0
  return { wx0, wx1, cx0, home, hx }
}

