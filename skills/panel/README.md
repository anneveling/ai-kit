# panel

A Claude Code skill that puts a big question (markets, geopolitics, health, society, a human experience) to a panel of independent voices. Each voice researches alone, then they attack each other, concede and update in a crossfire round. A scribe checks the claims everything rests on. The result is a three-layer page: the answer, the debate with a concessions board, and each voice's own notes.

It is close to a Delphi panel with a red team and a judge. Its job is trust, meaning you see what survives attack. It does not build a model from the bottom up with you.

Invoke it explicitly with `/panel <question>`. It never triggers on its own. A run takes 20–40 minutes and a lot of usage.

## Install

```bash
ln -s "$(pwd)/skills/panel" ~/.claude/skills/panel
```

## Files

| File | What |
|---|---|
| `SKILL.md` | The flow: sharpen → cast → fact scout → round 1 → crossfire → storyteller (optional) → scribe → page |
| `voices.md` | Briefs for every voice, the fact scout and the scribe, plus the shared labelling rules |
| `page/template.html` | The page; `{{…}}` placeholders are filled by `build.py` |
| `page/build.py` | Assembles a run folder into one HTML page |

## Lessons from the first run (pensions, euro and the Netherlands, Nov 2026)

- Watching voices concede is what made the outcome trustworthy, so the crossfire stays and the scribe writes a concessions board.
- The Alien, which gets no research and only the constraints, was the cheapest voice and one of the most original.
- Four voices fetched the same base tables separately. That's the reason for one shared fact pack, with reasoning kept separate.
- Round-1 notes of 30–40 KB per voice were too long to read and too costly to produce. They're now capped at 1,500 words.
- The interests voice gave breadth, not depth. A deeper players method is parked for its own skill.
- A bottom-up model built *with* you needs a different skill (`/bedrock`, not built yet).
