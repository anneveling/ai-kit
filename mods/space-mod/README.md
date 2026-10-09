# space-mod

A band above the Claude Code prompt that shows how the collaboration is going, drawn like a 90s Sierra adventure game. The Claude robot stands on the left of a spaceship deck, you stand on the right, and both react to what happens in the session.

```
 Claude: sulky                 Score: 15 of 202                 You: steering
   [ There's always a but. ]                            [ Yes, but... ]
      🤖 (rain cloud)        |  ✦  stars  ◍ planet  |  [::::]        🧔
 ▀▄▀▄▀▄▀▄▀▄▀▄▀▄▀▄▀▄▀▄▀▄▀▄▀▄▀▄▀▄▀▄▀▄▀▄▀▄▀▄▀▄▀▄▀▄▀▄▀▄▀▄▀▄▀▄▀▄▀▄▀▄▀▄▀▄▀▄▀▄▀▄▀
```

## What it shows

- **A Sierra-style status bar:** each character's mood and a score out of 202. Praise is +5, tests going from red to green +10, a PR opened +25, a PR merged +50.
- **Balloons:** the human says the gist of what you did, and the robot answers with a comeback. During long work the robot mumbles to itself in thought bubbles. A small model (Haiku) writes the lines from a short log of the session. They're about the dynamic between the two of you, not the literal text. When a call fails, a canned line takes its place.
- **Moods that move only when they mean something:**
  - Frustrated: the robot paces, with steam.
  - Sulky: a rain cloud over its head.
  - Waiting on you: it taps its foot and looks at you.
  - Bored: it looks around.
  - Context nearly full: it gets sleepy, then falls asleep. After compaction it gets a coffee.
  - You: a coffee mug after two hours or late at night, then dozing off when idle.
- **The deck reflects the overall mood:**
  - Calm: slow stars and a blue planet.
  - Tense: an amber stripe and a yellow planet.
  - Red alert: flashing lights and stars rushing past.
  - Late at night the lighting goes dim.
- **Moments:** confetti for green tests and PRs. Esc knocks the robot over, legs up, with a Sierra-style death message.

## Commands

| Command | What it does |
|---|---|
| `/band tone <text>` | How both characters talk, free text (e.g. `overly dramatic`, `dry and Dutch`). Kept across sessions. |
| `/band tone reset` | Back to the default voice. |
| `/band off` / `/band on` | Hide or show the band. |

To tune the humor itself, edit [`hooks/voice.ts`](hooks/voice.ts). It holds the rules and the example lines the model follows.

## Install

```
/plugin install space-mod --marketplace anneveling/ai-kit
```

Answer `y` to add the marketplace, then pick a scope.

## How it's built

A Claude Code mod: a plugin of function hooks (`hooks/register.tsx`).

| File | What it does |
|---|---|
| `hooks/register.tsx` | Listens to prompts, tool calls, turns and compaction. Keeps the session log and moods, and draws the band. |
| `hooks/brain.ts` | Pure rules: moods, the deck's alert level, test and PR detection, parsing the model's reply. |
| `hooks/voice.ts` | The characters' voice: system prompt, examples, canned fallbacks. |
| `hooks/art.ts` | Palette, sprites and the deck, as pixels on a grid of colors. |
| `hooks/svg.ts` | **Desktop:** the grid as one SVG of square pixels. The motion runs as SMIL animation inside it, so it's redrawn only when something changes. |
| `hooks/scene.tsx` | **Terminal:** the grid as text cells, each an upper half block (two pixels stacked), animated on the surface's frame clock. Click a character to poke it. |

Run the tests with `claude plugin test mods/space-mod`. Check the module with `claude plugin validate mods/space-mod`.

## Limits

- Poking the characters works in the terminal only. On desktop the SVG can't take clicks.
- On desktop the band's width is converted to pixels with an estimate of ~7.8 CSS px per column.
- Per prompt it makes one Haiku call, plus at most one mumble every 20 seconds during long work.
