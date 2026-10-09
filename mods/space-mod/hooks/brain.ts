// What the band knows about the session, and the rules that turn it into
// moods. Pure functions, so they can be tested without a session.

import type { HumanMood, RobotMood, Sky } from '../types'

export type Stats = {
  redirectsInRow: number
  praise: number
  lastPraiseAt: number
  escs: number
  lastEscAt: number
  errorsThisTurn: number
  turns: number
  isTestsRed: boolean
  isWorking: boolean
  sessionStartedAt: number
  lastActivityAt: number
  contextPercent: number
}

export const freshStats = (now: number): Stats => ({
  redirectsInRow: 0,
  praise: 0,
  lastPraiseAt: 0,
  escs: 0,
  lastEscAt: 0,
  errorsThisTurn: 0,
  turns: 0,
  isTestsRed: false,
  isWorking: false,
  sessionStartedAt: now,
  lastActivityAt: now,
  contextPercent: 0,
})

const MINUTE = 60_000

export const isTestCommand = (command: string) =>
  /\b(jest|vitest|pytest|mocha|rspec|phpunit|go test|cargo test|(npm|yarn|pnpm|bun)( run)? test|npm t)\b/.test(command) ||
  /\bclaude plugin test\b/.test(command)

export const prMoment = (command: string): 'opened' | 'merged' | null =>
  /\bgh pr create\b/.test(command) ? 'opened' : /\bgh pr merge\b/.test(command) ? 'merged' : null

const baseName = (path: unknown) => String(path ?? '').split('/').pop() || 'a file'
const clip = (text: unknown, n: number) => {
  const one = String(text ?? '').replace(/\s+/g, ' ').trim()
  return one.length > n ? one.slice(0, n - 1) + '…' : one
}

/** One log line for a tool call: what the robot did, at a glance. */
export const describeTool = (tool: string, input: Record<string, unknown>) => {
  switch (tool) {
    case 'Bash':
      return `ran \`${clip(input.command, 60)}\``
    case 'Edit':
    case 'Write':
    case 'NotebookEdit':
      return `edited ${baseName(input.file_path ?? input.notebook_path)}`
    case 'Read':
      return `read ${baseName(input.file_path)}`
    case 'Grep':
    case 'Glob':
      return `searched for "${clip(input.pattern, 30)}"`
    case 'WebFetch':
    case 'WebSearch':
      return 'looked something up online'
    case 'Agent':
    case 'Task':
      return 'sent a helper off on an errand'
    case 'Skill':
      return `picked up the ${clip(input.skill, 30)} manual`
    case 'AskUserQuestion':
      return 'asked you a question'
    default:
      return tool.startsWith('mcp__') ? `used ${tool.split('__')[1] ?? 'a connector'}` : `used ${tool}`
  }
}

export const clipText = clip

/** The robot's mood between moments, from what the session has been like. */
export const robotMoodFor = (s: Stats, now: number): RobotMood => {
  if (s.lastEscAt && now - s.lastEscAt < 4_000) return 'startled'
  if (s.isWorking) {
    if (s.errorsThisTurn >= 2) return 'frustrated'
    if (s.contextPercent >= 85) return 'sleepy'
    return 'focused'
  }
  if (s.contextPercent >= 90) return 'asleep'
  if (s.redirectsInRow >= 2) return 'sulky'
  if (now - s.lastActivityAt > 3 * MINUTE) return 'bored'
  if (s.contextPercent >= 70) return 'sleepy'
  if (s.lastPraiseAt && now - s.lastPraiseAt < MINUTE) return 'proud'
  return s.turns > 0 ? 'waiting' : 'content'
}

export const isLateHour = (date: Date) => date.getHours() >= 23 || date.getHours() < 6

/** The human's mood once a moment has worn off: tired, asleep, or as it was. */
export const humanRestingMood = (s: Stats, now: number, current: HumanMood, date: Date): HumanMood => {
  if (!s.isWorking && now - s.lastActivityAt > 10 * MINUTE) return 'asleep'
  if (now - s.sessionStartedAt > 120 * MINUTE || isLateHour(date)) return 'tired'
  if (current === 'asleep' || current === 'tired' || current === 'celebrating') return 'neutral'
  return current
}

/** The red-alert lights: how the collaboration feels overall right now. */
export const skyFor = (s: Stats, now: number): Sky => {
  let weather = 0
  if (s.lastPraiseAt && now - s.lastPraiseAt < 5 * MINUTE) weather += 1
  weather -= s.redirectsInRow
  weather -= Math.floor(s.errorsThisTurn / 2)
  if (s.lastEscAt && now - s.lastEscAt < 2 * MINUTE) weather -= 2
  if (weather <= -3) return 'alert'
  if (weather <= -1) return 'tense'
  return 'calm'
}

const HUMAN_MOODS: readonly HumanMood[] = ['neutral', 'happy', 'amused', 'curious', 'steering', 'impatient', 'annoyed']
const KINDS = ['praise', 'redirect', 'go', 'question', 'neutral'] as const
export type PromptKind = (typeof KINDS)[number]

export type Reply = {
  human: string | null
  robot: string | null
  humanMood: HumanMood | null
  kind: PromptKind | null
}

const line = (v: unknown) => {
  if (typeof v !== 'string') return null
  const t = v.trim().replace(/^["']|["']$/g, '')
  return t.length === 0 ? null : clip(t, 44)
}

/** Reads the model's answer: a JSON object, possibly wrapped in a fence. */
export const parseReply = (text: string): Reply | null => {
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) return null
  let raw: unknown
  try {
    raw = JSON.parse(match[0])
  } catch {
    return null
  }
  if (typeof raw !== 'object' || raw === null) return null
  const o = raw as Record<string, unknown>
  const humanMood = HUMAN_MOODS.find(m => m === o.humanMood) ?? null
  const kind = KINDS.find(k => k === o.kind) ?? null
  return { human: line(o.human), robot: line(o.robot), humanMood, kind }
}

/** The facts the line writer gets besides the log. */
export const countsLine = (s: Stats, now: number) => {
  const minutes = Math.round((now - s.sessionStartedAt) / MINUTE)
  return [
    `session: ${minutes} min, ${s.turns} turns`,
    `redirects in a row: ${s.redirectsInRow}`,
    `praise so far: ${s.praise}`,
    `Esc presses: ${s.escs}`,
    `robot errors this turn: ${s.errorsThisTurn}`,
    `tests: ${s.isTestsRed ? 'red' : 'fine'}`,
    `robot's memory: ${s.contextPercent}% full`,
  ].join(' · ')
}

export const pick = <T,>(list: readonly T[], seed: number): T => list[Math.abs(seed) % list.length] as T
