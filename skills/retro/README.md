# retro

A Claude Code skill for a short retro on how you and Claude work together. Every few days it reads your past sessions, finds where things got bumpy (confusion, back-and-forth, wrong assumptions, rework, interrupts), and proposes small changes to Claude's instructions and skills, plus habits you could try yourself. You pick what to adopt, and only then does it change anything.

It's a retro between you and Claude, not a team retrospective. It looks at your sessions with Claude only, not at how your team works. Asking Claude to help prepare your team's sprint retro won't trigger it.

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

## Make it yours: `~/.claude/retro.local.md`

Your own extras go in `~/.claude/retro.local.md`, not in the skill, so you can update the skill without losing them. The retro reads that file first and follows it alongside its own steps. It costs nothing outside a retro, and the retro can propose changes to it like to any other instruction.

Things people put in it:

- **An inbox to go through first:** a file or page where you save links and loose thoughts during the week, and how to close each item afterwards.
- **Parked items:** a list of things you decided not to do yet, to check for anything about how you work.
- **Extra lenses:** a check for one kind of work you do a lot, such as code reviews, with its own script or questions.
- **Which instructions to check:** your most-used skills and a word budget for each.
- **Signals that matter in your work:** for example "a migration that ran before review" or "a customer reply sent without a second read".
- **What not to touch:** files or sections the retro should never propose changes to.
- **Where the history goes:** where to record why a change was made, if not in the retro conversation.

An example:

```markdown
# My retro add-ons

1. **Inbox first.** Go through `~/notes/retro-inbox.md`: one line per item, ask
   "does this change how we work together?", then move each to "Discussed" with
   the outcome.
2. **Parked items.** Check `~/notes/parked.md` for anything about how we work.
3. **Review lens.** Also count how often I asked "is there already a ticket for
   this?" during code reviews, and propose a question for the review skill if
   it keeps coming up.
4. **Instruction check.** Also check `~/.claude/skills/review/SKILL.md`
   (budget ~2,000 words).
5. **Never propose** changes to the "Git Workflow" section of my CLAUDE.md.
```

## Files

| File | What |
|---|---|
| `SKILL.md` | The retro: window, signals to look for, instruction check, proposal format |
| `~/.claude/retro.local.md` | Yours, optional: your own add-ons, see above. Not part of this folder. |
| `scripts/sessions-since.py` | Prints your messages, Claude's replies and the noted, interrupt, rejection and walk-back markers since a date. Read-only, standard library only. |

## Privacy

Everything stays on your machine. The script only reads `~/.claude/projects/`, and the retro proposes edits to your local files.
