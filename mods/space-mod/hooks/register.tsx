import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { HumanMood, Line, RobotMood, Scene } from '../types'
import {
  clipText,
  countsLine,
  describeTool,
  freshStats,
  humanRestingMood,
  isLateHour,
  isTestCommand,
  parseReply,
  pick,
  prMoment,
  robotMoodFor,
  skyFor,
} from './brain'
import type { Stats } from './brain'
import { deckSvg } from './svg'
import { canned, deaths, DEFAULT_TONE, momentAsk, voiceSystem } from './voice'

const INITIAL: Scene = {
  robot: { mood: 'content', line: null },
  human: { mood: 'neutral', line: null },
  sky: 'calm',
  isNight: false,
  score: 0,
  beat: null,
  isOff: false,
}

const scene = atom({ plugin: 'space-mod', key: 'scene' } as const, INITIAL)

type Moment = 'prompt' | 'mumble' | 'turnEnd'

const MINUTE = 60_000
const LOG_LINES = 14
const BAND_ROWS = 9

// The session's story so far. Module state: a reload starts it over, which
// is fine for a band; the scene itself lives in $.state and survives.
const mem = {
  stats: freshStats(Date.now()) as Stats,
  log: [] as string[],
  pending: new Set<Moment>(),
  seq: Date.now() % 100_000,
  tone: DEFAULT_TONE,
  isSpeaking: false,
  lastCallAt: 0,
  lastMumbleAt: 0,
  newSinceMumble: 0,
  lastUsageAt: 0,
  hasSaidBored: false,
  turnStartedAt: 0,
  robotMoment: null as { mood: RobotMood; until: number } | null,
  humanMoment: null as { mood: HumanMood; until: number } | null,
}

function note(entry: string) {
  mem.log.push(entry)
  if (mem.log.length > LOG_LINES) mem.log.shift()
  mem.newSinceMumble += 1
}

function nextLine(text: string, isMumble: boolean, isReply: boolean): Line {
  mem.seq += 1
  return { id: mem.seq, text, isMumble, isReply, at: Date.now() }
}

async function say($: EngineInterface, human: string | null, robot: string | null, isMumble = false) {
  const h = human ? nextLine(human, false, false) : null
  const r = robot ? nextLine(robot, isMumble, h !== null) : null
  await update($, scene, s => ({
    ...s,
    human: h ? { ...s.human, line: h } : s.human,
    robot: r ? { ...s.robot, line: r } : s.robot,
  }))
}

async function beat($: EngineInterface, kind: 'celebrate' | 'esc' | 'coffee', points: number) {
  mem.seq += 1
  const id = mem.seq
  await update($, scene, s => ({ ...s, score: s.score + points, beat: { id, kind, at: Date.now() } }))
}

// Moods, lights and night, from the rules; written only when they change.
async function refresh($: EngineInterface) {
  const now = Date.now()
  if (mem.robotMoment && mem.robotMoment.until < now) mem.robotMoment = null
  if (mem.humanMoment && mem.humanMoment.until < now) mem.humanMoment = null
  const current = await read($, scene)
  const robot = mem.robotMoment?.mood ?? robotMoodFor(mem.stats, now)
  const human = mem.humanMoment?.mood ?? humanRestingMood(mem.stats, now, current.human.mood, new Date(now))
  const sky = skyFor(mem.stats, now)
  const isNight = isLateHour(new Date(now))
  if (
    current.robot.mood !== robot ||
    current.human.mood !== human ||
    current.sky !== sky ||
    current.isNight !== isNight
  ) {
    await update($, scene, s => ({
      ...s,
      robot: { ...s.robot, mood: robot },
      human: { ...s.human, mood: human },
      sky,
      isNight,
    }))
  }
}

async function celebrate($: EngineInterface, points: number, robotLine: string) {
  const until = Date.now() + 6_000
  mem.robotMoment = { mood: 'celebrating', until }
  mem.humanMoment = { mood: 'celebrating', until }
  await beat($, 'celebrate', points)
  await say($, pick(canned.humanCelebrate, mem.seq), robotLine)
  await refresh($)
}

async function readUsage($: EngineInterface) {
  mem.lastUsageAt = Date.now()
  try {
    const usage = await $.session.usage()
    const { percent, tokens, window } = usage.context
    mem.stats.contextPercent = Math.round(percent ?? (tokens && window ? (tokens / window) * 100 : 0))
  } catch {
    // No reading: keep the last one.
  }
}

// One call to the small model: it writes the balloons for this moment.
async function speak($: EngineInterface, moment: Moment) {
  mem.isSpeaking = true
  mem.lastCallAt = Date.now()
  try {
    const prompt = [
      'SESSION LOG (oldest first; "you" is the human, "me" is the robot):',
      mem.log.join('\n') || '(nothing yet)',
      '',
      `COUNTS: ${countsLine(mem.stats, Date.now())}`,
      '',
      momentAsk[moment],
    ].join('\n')
    const answer = await $.model.complete({
      model: 'haiku',
      system: voiceSystem(mem.tone),
      prompt,
      maxTokens: 160,
      timeoutMs: 12_000,
    })
    const reply = answer.isAnswered ? parseReply(answer.text) : null
    const stats = mem.stats

    if (moment === 'prompt') {
      const kind = reply?.kind ?? 'neutral'
      const now = Date.now()
      if (kind === 'praise') {
        stats.praise += 1
        stats.lastPraiseAt = now
        stats.redirectsInRow = 0
        await update($, scene, s => ({ ...s, score: s.score + 5 }))
      } else if (kind === 'redirect') {
        stats.redirectsInRow += 1
      } else if (kind === 'go') {
        stats.redirectsInRow = 0
      }
      if (reply?.humanMood) mem.humanMoment = { mood: reply.humanMood, until: now + 90_000 }
      await say(
        $,
        reply?.human ?? pick(canned.humanGist, mem.seq),
        reply?.robot ?? pick(canned.robotReply, mem.seq),
      )
    } else if (moment === 'mumble') {
      await say($, null, reply?.robot ?? pick(canned.mumble, mem.seq), true)
    } else {
      await say($, reply?.human ?? null, reply?.robot ?? pick(canned.robotReply, mem.seq))
    }
    await refresh($)
  } finally {
    mem.isSpeaking = false
  }
}

// The heartbeat: mumbles during long work, boredom, tiredness, lights.
async function tick($: EngineInterface) {
  const now = Date.now()
  const stats = mem.stats
  if (stats.isWorking && now - mem.lastMumbleAt > 25_000 && mem.newSinceMumble > 0) {
    mem.pending.add('mumble')
    mem.lastMumbleAt = now
    mem.newSinceMumble = 0
  }
  if (!stats.isWorking && !mem.hasSaidBored && now - stats.lastActivityAt > 3 * MINUTE) {
    mem.hasSaidBored = true
    await say($, null, pick(canned.bored, mem.seq), true)
  }
  if (now - mem.lastUsageAt > 30_000) await readUsage($)

  if (!mem.isSpeaking && mem.pending.size > 0) {
    const moment: Moment = mem.pending.has('prompt') ? 'prompt' : mem.pending.has('turnEnd') ? 'turnEnd' : 'mumble'
    if (moment === 'prompt' || now - mem.lastCallAt > 20_000) {
      mem.pending.delete(moment)
      await speak($, moment)
    }
  }
  await refresh($)
}

async function afterTool($: EngineInterface, tool: string, input: Record<string, unknown>, isDenied: boolean, isError: boolean) {
  const stats = mem.stats
  note(`me: ${describeTool(tool, input)}${isDenied ? ' — you said no' : isError ? ' ✗' : ' ✓'}`)
  if (isDenied) {
    stats.redirectsInRow += 1
    mem.humanMoment = { mood: 'steering', until: Date.now() + 60_000 }
  } else if (isError) {
    stats.errorsThisTurn += 1
  }
  if (tool === 'Bash') {
    const command = String(input.command ?? '')
    if (isTestCommand(command)) {
      if (isError) stats.isTestsRed = true
      else if (!isDenied && stats.isTestsRed) {
        stats.isTestsRed = false
        stats.errorsThisTurn = 0
        await celebrate($, 10, 'Green! All green!')
      }
    }
    const pr = isError || isDenied ? null : prMoment(command)
    if (pr === 'opened') await celebrate($, 25, pick(canned.celebrate, mem.seq))
    if (pr === 'merged') await celebrate($, 50, 'Merged. I need a lie down.')
  }
  if (isError && stats.errorsThisTurn === 3) await say($, null, pick(canned.frustrated, mem.seq), true)
  await refresh($)
}

async function afterTurn($: EngineInterface, isAborted: boolean, answer: string) {
  const now = Date.now()
  const stats = mem.stats
  stats.isWorking = false
  stats.lastActivityAt = now
  mem.hasSaidBored = false
  if (isAborted) {
    stats.escs += 1
    stats.lastEscAt = now
    stats.redirectsInRow += 1
    note('you: pressed Esc and stopped me')
    mem.robotMoment = { mood: 'startled', until: now + 4_000 }
    mem.humanMoment = { mood: 'impatient', until: now + 60_000 }
    await beat($, 'esc', 0)
    await say($, null, pick(canned.esc, mem.seq))
    $.ui.toast(pick(deaths, mem.seq), { timeoutMs: 6_000 })
  } else {
    stats.turns += 1
    note(`me: answered "${clipText(answer, 120)}"`)
    if (now - mem.turnStartedAt > MINUTE) mem.pending.add('turnEnd')
  }
  await readUsage($)
  await refresh($)
}

async function afterCompact($: EngineInterface) {
  mem.stats.contextPercent = 0
  note('me: my memory got compacted')
  await beat($, 'coffee', 0)
  await say($, null, pick(canned.coffee, mem.seq))
  await refresh($)
}

async function runBand($: EngineInterface, args: string) {
  const [word = '', ...rest] = args.trim().split(/\s+/)
  const text = rest.join(' ').trim()
  switch (word.toLowerCase()) {
    case 'tone':
      if (text.length === 0) return `Band tone: ${mem.tone}`
      mem.tone = text === 'reset' ? DEFAULT_TONE : text
      await $.store.set('tone', mem.tone)
      await say($, 'New voice. Try it.', 'Ahem. Testing, testing.')
      return `Band tone set to: ${mem.tone}`
    case 'off':
      await update($, scene, s => ({ ...s, isOff: true }))
      return 'Band hidden. /band on brings it back.'
    case 'on':
      await update($, scene, s => ({ ...s, isOff: false }))
      return 'Band is back.'
    default:
      return `Usage: /band tone <how they talk> (now: ${mem.tone}) · /band tone reset · /band off · /band on`
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    mem.stats = freshStats(Date.now())
    const stored = await $.store.get('tone')
    if (typeof stored === 'string' && stored.length > 0) mem.tone = stored
    await $.command.register({
      name: 'band',
      description: 'The deck band: /band tone <how they talk>, /band off, /band on',
      argumentHint: 'tone <text> | off | on',
    })
    $.clock.every(1_000, () => {
      if (mem.isSpeaking) return
      tick($).catch(() => {
        mem.isSpeaking = false
      })
    })

    return next(e)
  })

  on('command.run', { command: 'band' }, async ($, e) => ({ text: await runBand($, e.args) }))

  on('prompt.submit', async ($, e, next) => {
    const isPerson = e.origin.kind === 'composer' || e.origin.kind === 'bridge'
    if (isPerson && !e.text.trimStart().startsWith('/')) {
      note(`you: "${clipText(e.text, 160)}"`)
      mem.stats.lastActivityAt = Date.now()
      mem.hasSaidBored = false
      mem.lastMumbleAt = Date.now()
      mem.pending.add('prompt')
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.start', async ($, e, next) => {
    mem.stats.isWorking = true
    mem.stats.errorsThisTurn = 0
    mem.turnStartedAt = Date.now()

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    const input = e as unknown as Record<string, unknown>
    if (input.agentId === undefined) {
      const isDenied = ran.deny !== undefined
      await afterTool($, String(e.tool), input, isDenied, !isDenied && ran.isError === true).catch(() => {})
    }

    return ran
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) await afterTurn($, e.isAborted, e.answer).catch(() => {})

    return next(e)
  })

  on('session.compact', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined) await afterCompact($).catch(() => {})

    return result
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const s = await read($, scene)
    if (e.props.hasSurvey || s.isOff) return next(e)
    if (e.surface === 'desktop') {
      // The desktop draws text in its own font, not a cell grid: real pixels there.
      const { Svg } = $.ui.resolve(e)
      const art = deckSvg({ ...s, isWorking: e.props.isWorking }, Date.now(), e.props.bodyColumns)
      return <Svg source={art.source} alt={art.alt} width={art.width} height={art.height} isInteractive />
    }
    if (e.surface !== 'terminal') return next(e)
    const { Client } = $.ui.resolve(e)
    const rows = e.props.maxRows >= BAND_ROWS ? BAND_ROWS : 1

    return (
      <Client
        key="deck"
        module="./scene.tsx"
        props={{ ...s, isWorking: e.props.isWorking, rows }}
        width="100%"
        height={rows}
      />
    )
  })
}
