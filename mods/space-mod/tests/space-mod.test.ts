import { describe, expect, mock, test } from 'claude-code/testing'

import { freshStats, isTestCommand, parseReply, prMoment, robotMoodFor, skyFor } from '../hooks/brain'
import { deckSvg, wrap } from '../hooks/svg'

const BAND = {
  plugin: 'space-mod',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 20,
    bodyColumns: 100,
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
  viewport: { columns: 105, rows: 40 },
} as const

describe('the brain', () => {
  test('reads the line writer’s JSON, fenced or not', async () => {
    const reply = parseReply('```json\n{"human": "Yes, but...", "humanMood": "steering", "robot": "There\'s always a but.", "kind": "redirect"}\n```')
    expect(reply).toEqual({ human: 'Yes, but...', robot: "There's always a but.", humanMood: 'steering', kind: 'redirect' })
    expect(parseReply('no json here')).toBeNull()
    expect(parseReply('{"robot": "hi", "humanMood": "furious"}')?.humanMood).toBeNull()
  })

  test('moods follow the session', async () => {
    const now = 1_000_000
    const s = freshStats(now)
    expect(robotMoodFor(s, now)).toBe('content')
    expect(robotMoodFor({ ...s, isWorking: true, errorsThisTurn: 2 }, now)).toBe('frustrated')
    expect(robotMoodFor({ ...s, redirectsInRow: 2, turns: 3 }, now)).toBe('sulky')
    expect(robotMoodFor({ ...s, turns: 1, lastActivityAt: now - 4 * 60_000 }, now)).toBe('bored')
    expect(robotMoodFor({ ...s, contextPercent: 95 }, now)).toBe('asleep')
    expect(robotMoodFor({ ...s, lastEscAt: now - 1_000 }, now)).toBe('startled')
  })

  test('the red-alert lights come on when it gets bumpy', async () => {
    const now = 1_000_000
    const s = freshStats(now)
    expect(skyFor(s, now)).toBe('calm')
    expect(skyFor({ ...s, redirectsInRow: 1 }, now)).toBe('tense')
    expect(skyFor({ ...s, redirectsInRow: 1, lastEscAt: now - 1_000 }, now)).toBe('alert')
  })

  test('spots tests and PRs in commands', async () => {
    expect(isTestCommand('npm test -- --watch=false')).toBe(true)
    expect(isTestCommand('npx vitest run')).toBe(true)
    expect(isTestCommand('git status')).toBe(false)
    expect(prMoment('gh pr create --assignee @me')).toBe('opened')
    expect(prMoment('gh pr merge 12 --squash')).toBe('merged')
    expect(prMoment('gh pr view')).toBeNull()
  })
})

test('the terminal draws the deck in text cells', async $ => {
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.resize({ columns: 100, rows: 9 })
  await ui.advance(500)
  const drawn = JSON.stringify(await ui.drawn({ in: 'deck' }))
  expect(drawn).toContain('Score: 0 of 202')
  expect(drawn).toContain('Claude: content')
  expect(drawn).toContain('You: neutral')
  await ui.unmount()
})

test('the desktop draws the deck as one animated SVG', async $ => {
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const svg = await ui.find({ type: 'Svg' })
  const source = String(svg?.props.source ?? '')
  expect(source).toContain('Score: 0 of 202')
  expect(source).toContain('<animate')
  expect(source.length).toBeLessThan(131072)
  expect(svg?.props.isInteractive).toBe(true)
  await ui.unmount()
})

test('poking the robot gets a reaction', async $ => {
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.resize({ columns: 100, rows: 9 })
  await ui.advance(250)
  await ui.pointer({ type: 'down', x: 12, y: 7, button: 'left' })
  await ui.advance(250)
  const drawn = JSON.stringify(await ui.drawn({ in: 'deck' }))
  expect(/Hey!|Personal space!|Boop\.|working here|I dare you/.test(drawn)).toBe(true)
  await ui.unmount()
})

test('/band tone sets how they talk', async ($, on) => {
  mock.store(on)
  const ran = await $.command.run({ command: 'band', args: 'tone overly dramatic' } as Parameters<typeof $.command.run>[0])
  expect(JSON.stringify(ran)).toContain('overly dramatic')
})

describe('balloons', () => {
  test('wrap onto two lines, then an ellipsis', async () => {
    expect(wrap('one command failed. pretending it did not', 22)).toEqual(['one command failed.', 'pretending it did not'])
    expect(wrap('short one', 22)).toEqual(['short one'])
    const long = wrap('this line just keeps going and going and going on', 16)
    expect(long).toHaveLength(2)
    expect(long[1]?.endsWith('…')).toBe(true)
  })

  test('stay in their own half when both speak', async () => {
    const now = Date.now()
    const line = (id: number, text: string) => ({ id, text, isMumble: false, isReply: false, at: now })
    const scene = {
      robot: { mood: 'content' as const, line: line(2, 'one command failed. pretending it did not happen at all') },
      human: { mood: 'neutral' as const, line: line(1, 'make it bigger, and the text easier to read please') },
      sky: 'calm' as const,
      isNight: false,
      score: 0,
      beat: null,
      isOff: false,
      isWorking: false,
    }
    const { source } = deckSvg(scene, now, 100)
    const W = Number(source.match(/viewBox="0 0 (\d+)/)?.[1])
    const boxes = [...source.matchAll(/<rect x="([\d.]+)" y="3.5" width="([\d.]+)"/g)].map(m => [Number(m[1]), Number(m[1]) + Number(m[2])])
    expect(boxes).toHaveLength(2)
    const [robot, human] = boxes.sort((a, b) => a[0]! - b[0]!)
    expect(robot![1]!).toBeLessThanOrEqual(W / 2)
    expect(human![0]!).toBeGreaterThanOrEqual(W / 2)
  })
})
