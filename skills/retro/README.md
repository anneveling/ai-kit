# retro

A Claude Code skill for a short retro on how you and Claude work together. Every few days it reads your past sessions, finds where things got bumpy (confusion, back-and-forth, wrong assumptions, rework, interrupts), and proposes small changes to Claude's instructions and skills, plus habits you could try yourself. You pick what to adopt, and only then does it change anything.

## Why it works

- **Nothing to log.** Normal sessions don't write anything down. The transcripts Claude Code already keeps are the record, and the retro reads them.
- **Claude says when something went wrong.** A few lines in your global `CLAUDE.md` let Claude notice friction while you work. At the end it says so in one line, for example "The plan changed three times before we agreed on scope. Noted for the next retro (due Monday), or we can do one now." It only pushes for a retro once one is due, at most every five days. A skill on its own can't do this, because it only loads when it's called. If you reply "that was fine", the note is dropped.
- **Instructions stay short.** Each retro also checks your instructions: what never fires, what you keep overriding, what's said twice. Every rule it adds names one it replaces.
- **Both sides.** It also tells you what you could do differently, with evidence, not only what Claude should change.

```
every session (CLAUDE.md)                    every few days (this skill)
  notice friction ─► "Noted for the next     read sessions since the last one,
                      retro, or now" ──now──► starting from the noted lines
                                             → signals → patterns → proposals
                                             → you pick → edits → `ran:` updated
```

## Install

1. Link the skill:

   ```bash
   ln -s "$(pwd)/skills/retro" ~/.claude/skills/retro
   ```

2. Add this to `~/.claude/CLAUDE.md`:

   ```markdown
   ## Retros
   When you notice friction (I steered the same topic 2–3 times, a plan was reshaped
   more than once, you explained something again, I said I'm confused, or you added
   machinery I removed), end with one line at a natural pause, never mid-task: what
   went wrong as one concrete fact, whose it was ("I" or "we"), and when the next
   retro is due, or offer one now. Example: "The plan changed three times before we
   agreed on scope. Noted for the next retro (due Monday), or we can do one now."
   If I say it was fine, drop it. Throttle: `~/.claude/retro-log` holds `ran:` and
   `offered:`. The next retro is due 5 days after `ran`. Once it's due and `offered`
   isn't today, suggest doing it now and update `offered`; before that, just mention
   it. Asking for one myself is never throttled. Run it with the `retro` skill.

   ## How I like to work
   (Retros add to this section.)
   ```

3. Run the first one yourself: `/retro`. Without a `retro-log` it looks back 7 days.

Optional: if you keep a list of topics to discuss (a file or a page), name it in the Retros section and the retro goes through it first.

## Files

| File | What |
|---|---|
| `SKILL.md` | The retro: window, signals to look for, instruction check, proposal format |
| `scripts/sessions-since.py` | Prints your messages, Claude's replies and the noted, interrupt, rejection and walk-back markers since a date. Read-only, standard library only. |

## Privacy

Everything stays on your machine. The script only reads `~/.claude/projects/`, and the retro proposes edits to your local files.
