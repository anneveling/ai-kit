---
name: retro
description: A short retro between the user and Claude on how the two of them work together, covering every session since the last one. Reads the transcripts, spots friction (confusion, back-and-forth, wrong assumptions, rework, interrupts), groups it into patterns and proposes concrete changes to CLAUDE.md, skills and memory, plus habits the user could try. Use when the user asks for a retro with Claude, a look back at our sessions, lessons learned on how we work together, or "what should we change", and when running a retro offered under the "Retros" rule in CLAUDE.md. Not for a team or sprint retrospective with colleagues: for preparing or running one of those, help directly without this skill.
---

<!-- version: 0.2.0 | source: https://github.com/anneveling/ai-kit/tree/main/skills/retro -->

# Retro

A retro between the user and Claude on *how the two of them work together*, not on what got built. It is not a team retrospective: colleagues come up only as context the user had or didn't give. It looks back over every session since the last retro, finds where the collaboration cost time or trust, and proposes small changes to Claude's instructions and to the user's habits. Nothing gets saved during normal sessions: the transcripts already hold everything, and this skill reads them.

## Rules

1. **Propose, then wait.** Change no file until the user says which proposals to adopt.
2. **Patterns, not incidents.** A lesson needs at least two sessions showing it, or one moment that was costly (lost work, a wrong thing posted, trust lost). Leave one-offs out.
3. **Evidence for everything.** Every lesson names the session and date and quotes one line. If you can't point to it, it's a hunch: say so or drop it.
4. **Both sides.** Be as direct about what the user could do differently as about Claude. A retro that only finds Claude's mistakes is half a retro. Phrase the user's side as something to try, with the evidence.
5. **System cause first.** Before blaming anyone, look for what made the mistake easy: missing context, an unclear or conflicting rule, a missing tool. "Be more careful" is not a proposal.
6. **Remove before you add.** Every rule you propose names what it replaces or removes. Instructions only work if they stay short.

## Your own add-ons

If `~/.claude/retro.local.md` exists, read it before step 1 and follow it alongside these steps. It holds the user's own extras: an inbox to go through, extra checks, which files to look at. Where it's more specific than this skill, it wins. A change to how this user's retro runs goes there, not into this skill.

## 1. Set the window

Read `~/.claude/retro-log` (lines `ran: YYYY-MM-DD` and `offered: YYYY-MM-DD`). The window starts at `ran:`. If the file doesn't exist, use the last 7 days and create it when the retro is done. If the window holds more than about 60 sessions, say so and suggest the most recent two weeks.

## 2. Gather

```bash
python3 -I ~/.claude/skills/retro/scripts/sessions-since.py <ran date> > <scratchpad>/retro-sessions.txt
```

The script prints, per session: what the user typed, the start of the Claude reply they were answering, and markers: `[NOTED]` (Claude flagged friction at the end of a reply, under the "Retros" rule in `CLAUDE.md`), `[INTERRUPT]`, `[REJECTED]` (a declined tool call, with the reason if one was given) and `[WALK-BACK]` (Claude taking something back). The last line has the totals. Start from the `[NOTED]` lines. Skip one the user waved off ("that was fine"), and look for friction that went unnoted too. It leaves out injected text, so a word like "confused" in an instruction file doesn't count as the user saying it.

The output is long. Read the `===` header lines and their counts first, then read the sessions where markers or short pushbacks cluster in full. `--claude 0` shows the user's messages only, and `--project <text>` narrows it to some projects. For more of an exchange, rerun with `--project` and a larger `--claude`. Never open the raw `.jsonl` files: they're mostly tool output and run to millions of tokens.

Also read **the previous retro**, usually the first session in the window: what it changed, and the counts it reported.

## 3. Look for these signals

| Signal | What it looks like | Usually means |
|---|---|---|
| **Interrupts, rejected tool calls** | `[INTERRUPT]`, `[REJECTED]` | Claude ran ahead, or picked the wrong action or scope |
| **Confusion or frustration** | "I'm confused", "what do you mean", "so many X", the same question twice, a one-word "?", replies getting shorter and sharper, "again", "just do X" | The point came after the detail, a term the user never used, or Claude not listening |
| **Back-and-forth** | The same topic steered 3+ times, a plan reshaped more than once, "no, I meant…" | The goal, scope or "done when" wasn't pinned down at the start |
| **Wrong assumptions** | `[WALK-BACK]` with a new fact behind it, or the user supplies a fact Claude could have looked up | A claim rested on something unchecked |
| **Caving** | `[WALK-BACK]` or a changed position after pushback, with no new fact, file or source behind the change | Claude agreeing rather than checking. Worse than the original mistake, because it hides who was right |
| **"Done" that wasn't** | Claude said done, fixed or working, then the user found it broken, incomplete or untested | Claimed without verifying |
| **Telling it again** | The user explains the same background, preference or constraint in two or more sessions | A memory or `CLAUDE.md` gap |
| **Over- or under-asking** | Claude asked what the code or docs would have answered, or built the wrong thing without asking | The bar for asking versus acting is off |
| **Wrong one doing the work** | The user did mechanical work Claude could have done (copy-pasting, relaying between sessions, running commands), or Claude made a call that was the user's | The split of work is off |
| **Machinery creep** | Claude adds a file, flag, step or abstraction, and the user removes it | Thorough was mistaken for better |
| **Rework** | The same intent edited several times, a revert, a task abandoned partway | Building started before agreeing on what |
| **Explanation misses** | A long answer followed by "tl;dr" or a short question that should have been answered first | Wrong order or wrong level |
| **Confused, then approved** | The user said something was unclear, then approved, posted or merged without it getting clearer | A trust slip, the costliest signal: catch it every time |
| **Surprising calls** | The user decided something Claude didn't expect, with or without a reason | A way of judging worth learning, or a one-off |
| **What worked** | The first proposal accepted, "perfect", a long task with no corrections | Keep it, and say what made it work |

On the user's side, look for:
- A request that started without a goal or a "done when", followed by rework.
- Scope that changed partway through without being said.
- Context the user had and didn't give (a teammate's decision, a constraint, a deadline).
- Approving or posting without reading.

These are prompts, not a checklist to fill in. Report what the transcripts show.

## 4. Check the instructions

Instructions that load in every session (global and repo `CLAUDE.md`) cost something every time, so they should be short. Skills load only when used, so detail belongs there. Check the global `CLAUDE.md` (aim for under ~1,500 words; measure with `wc -w`) and the skills used most in the window:

- **Did it fire?** Look in Claude's own output in the transcripts, not in the instruction text. A rule that hasn't fired in weeks: shorten it, or ask whether it's still needed.
- **Should it have fired and didn't?** A rule covered the situation and Claude ignored it: the rule is in the wrong place, too vague, or buried.
- **Did the user override it?** A rule the user keeps correcting is wrong or out of date.
- **Duplicates and conflicts:** say it once, in the place that loads when it's needed.
- **History stays out:** why a rule exists belongs in the retro conversation, which the next retro can read, not in the instruction.
- **Did the last retro's changes work?** For each change the previous retro made, check whether its signal went down.

## 5. Run the retro

Open with one question: "What stood out for you since last time?" Then share what you found, short and in this order:

1. **Counts** next to the previous retro's: sessions, noted, interrupts, rejected calls, walk-backs (and how many of those were caving), confused-then-approved moments.
2. **What worked** (up to 3).
3. **What Claude could do better** (up to 3).
4. **What you could try** (up to 3).
5. **Instruction check:** what to cut, merge or move.

Then the proposals, one block each. Mark the 1–3 you'd adopt first: more than that doesn't stick, and the next retro checks whether they worked.

> **Lesson:** one sentence.
> **Evidence:** session, date, one quoted line (two sessions where you can).
> **Whose:** Claude, user, or both.
> **Where it lands:** see below.
> **Change:** the exact text to add or edit, and what it replaces or removes.

Where lessons land:
- How the user wants things explained or wants to work together → a section like "How I like to work" in their global `CLAUDE.md`.
- About one repo → that repo's `CLAUDE.md`.
- How one skill behaves → that skill.
- A fact about the user or a project → memory.
- Something the user does → a habit to try. No file, unless they want one.
- Something a tool can enforce → a lint rule, test or hook.
- How the retro itself runs, for this user → `~/.claude/retro.local.md`.
- A one-off → don't codify.

## 6. Apply

Apply only the proposals the user picked, exactly as agreed. Then set `ran:` in `~/.claude/retro-log` to today, and end with what changed and where, one line per file.
