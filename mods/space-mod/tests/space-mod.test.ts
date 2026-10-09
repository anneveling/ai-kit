import { describe, expect, mock, test } from 'claude-code/testing'

import { freshStats, isTestCommand, parseReply, prMoment, robotMoodFor, skyFor } from '../hooks/brain'

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
