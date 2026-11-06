---
name: panel
description: Run a panel of independent voices on a big question (markets, geopolitics, health, society, a human experience). Each voice researches alone, then they attack, concede and update in a crossfire, and a scribe checks the load-bearing sources. Ends in a three-layer page. Heavy and slow; only when the user invokes /panel.
disable-model-invocation: true
---

# /panel: a panel of voices that challenge each other

A panel gives the user **trust**: they see which claims survive attack, who conceded what, and where the real disagreement (the crux) sits. It is not a bottom-up model and not a tutor; for understanding from first principles, suggest `/bedrock` afterwards (when it exists).

The method is close to a Delphi panel (independent rounds, then feedback and revision) with a red team and a judge. **Reasoning stays independent; base facts are shared.** In the first run, four voices fetched the same tables separately, which cost a lot and produced only date mismatches.

A run takes 20–40 minutes and a lot of usage. Say so in one line when you start.

## The flow

```
 you ─► 1 Sharpen ─► 2 Cast ─► 3 Fact scout ─► 4 Round 1 ─► 5 Crossfire ─► 6 Story* ─► 7 Scribe ─► 8 Page ─► you
       (with you)   (you swap)  (one pack)     (separate,   (attack,       (optional)  (checks,
                                               in parallel)  concede)                   synthesis)
```

| Step | Who | Model · effort | Budget |
|---|---|---|---|
| 1 Sharpen, 2 Cast | you + user | — | wait for the user's go at each |
| 3 Fact scout | 1 subagent | `sonnet` · medium | ≤ 20 lookups → `facts.md`, ≤ 25 facts |
| 4 Round 1 | 4–6 voices in parallel, background | inherit · high | ≤ 15 lookups, notes ≤ 1,500 words, reply ≤ 300 words |
| 5 Crossfire | same voices via SendMessage | same | ≤ 8 lookups, notes ≤ 600 words, reply ≤ 200 words |
| 6 Storyteller | 1 subagent, optional | inherit · medium | no research, ≤ 1,500 words |
| 7 Scribe | 1 subagent | inherit · high | verifies ≤ 10 claims, synthesis ≤ 3,000 words |
| 8 Page | you | — | template + `build.py`, one publish |

Effort levels and models are set by this skill; pass them on the Agent calls. If round 1 comes back thin, say so; don't silently rerun.

Work in a folder in the scratchpad: `<scratchpad>/panel-<slug>/`. Every voice writes its notes there.

## 1. Sharpen the question (with the user)

Ask, in one message:
1. The question in one sentence.
2. Its borders: **where**, **how far ahead**, **for whom** (the user, a system, a group).
3. What's out.
4. **Their gut now**: what they believe before any research. Write it as a chain (`A → B → C`) when it has steps; the red team will attack it link by link.
5. What they will do with the answer. This shapes the output (e.g. "read the news better" → a news decoder; "help my children" → a household section).

Then propose the scope as a small table (question · where · horizon · for whom · out · gut · use) and wait for "go" or changes. Out of scope by default: personal investment, medical or legal advice. The panel maps mechanisms and risks; personal decisions belong with a licensed professional.

## 2. Propose the cast (the user swaps or adds)

Pick voices for how much they will **disagree**, not for coverage. Use [voices.md](voices.md) for the briefs.

- **Always:** Red team, Alien, Historian.
- **1–2 subject voices** that each think the root of the problem sits somewhere else (e.g. "it's money" vs "it's votes"; "it's the receptor" vs "it's the immune system").
- **Optional:** Storyteller (scenarios, humour) when the question is about futures; skip it for a mechanism question.
- **Mode:** for a *human experience* (grief, guilt, shame), voices become lenses (attachment biology, psychology, philosophy, culture, the user's own experience); the crossfire asks "what does your lens see that the others miss?", not "attack"; the user's lived experience counts as evidence only they hold. Be gentle; never diagnose.

Show the cast as a table (voice · why this one · its first move) and wait for "go".

## 3. Fact scout

One subagent (`model: sonnet`, `effort: medium`) gathers the 15–25 base numbers and facts every voice will need, from primary sources, with URL and date, labelled per voices.md. Where two sources differ, it lists both and why (date, definition). Output: `facts.md`. Write `00-brief.md` (question, borders, gut, use, rules from voices.md) before you start it.

## 4. Round 1: voices in parallel

Spawn every voice in the background in one message, each with `00-brief.md`, `facts.md` and its role brief from voices.md. The **Alien gets neither**: only its constraints paragraph, which you write from the scope, naming no real institutions, and no tools. Voices must not see each other in this round.

While they run, say one line per returning voice: its sharpest point. The user follows along; keep it short.

## 5. Crossfire

Write `10-digest.md`: per voice its 4–5 claims and the one it rests on, plus a list of **conflicts** (factual and interpretive). Then SendMessage each voice (continuing the same agent): read the digest, land 2 hits on others, say what it concedes and why, update its one-claim, resolve the conflict you assign it. The Alien now meets the real world: which of its rules are habits the humans could drop, and which are lessons they learned the hard way (Chesterton's fence)?

Concessions are the point: the user said watching voices concede is what makes the outcome trustworthy. Ask for them explicitly.

## 6. Storyteller (optional)

After the crossfire, so the scenarios are built on the cruxes. Brief in voices.md. Fictional publications and people only; real people appear only as roles.

## 7. Scribe

One subagent, effort high. Brief in voices.md. It checks the ≤ 10 claims the synthesis rests on, then writes `synthesis.md` with fixed sections and word limits.

## 8. Page

Build with the template in `page/`:

1. Write `hero.html` (the point-first answer, 2–3 short paragraphs) and `gut.html` (the user's gut as cards with verdict chips) into the run folder, using the classes in `page/template.html` (`.answer`, `.chain`, `.link v-holds|v-partly|v-nope|v-unknown`, `.chip`).
2. Optional `extra.html`: one subject-specific section (an interactive model, a diagram), only if a voice produced something worth playing with.
3. Write `voices.json`: `[{"name","lens","claim","files":[["label","file.md"],…]}]`; end with a "The brief" entry pointing at `00-brief.md`, `facts.md` and `synthesis.md`.
4. Run `python3 -I <skill>/page/build.py <run-folder> <run-folder>/<slug>.html <skill>/page/template.html`, then `node --check` the extracted inline script, then publish with the Artifact tool (load `artifact-design` guidance via quickstart first; icon one generic word).

The page has three layers: **1** answer, gut, cruxes, synthesis · **2** the debate and the concessions board · **3** each voice in full.

## 9. Close

In chat: the point first (one sentence, especially where it contradicts the user's gut), the link, the 2–3 cruxes, the verification tally, what the scribe found wrong, and an offer of the teach-back questions. Say how long it took and that it was a heavy run.
