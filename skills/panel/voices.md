# Voice briefs

Copy the shared rules into `00-brief.md`. Give each voice its role brief plus the paths of `00-brief.md`, `facts.md` and its notes file. Fill the `<…>` parts from the scope.

## Shared rules (every researching voice)

1. **Start from `facts.md`.** Research only what your angle needs beyond it (≤ 15 lookups in round 1, ≤ 8 in the crossfire). Load web tools with ToolSearch `select:WebSearch,WebFetch`. Prefer primary sources; give the year of every number.
2. **Label every claim:** `[data]` (official statistic or measured fact, with URL and year) · `[consensus]` (say whose) · `[analogy]` · `[guess]`. About what people want: `[documented]` (they said or did it, with source) or `[inferred]` (follows from incentives). Add `[memory]` to anything not verified in this session.
3. **Quantities over adjectives.**
4. **Notes ≤ 1,500 words** (crossfire ≤ 600), plain English, jargon explained the first time. The user may read them.
5. **Reply ≤ 300 words** (crossfire ≤ 200): your 5 strongest claims, the ONE claim your view rests on, what would change your mind, where you expect disagreement.
6. No personal investment, medical or legal advice. Mechanisms and risks only.

## Fact scout

> Gather the 15–25 facts and numbers every voice on this question will need: <list the obvious ones from the scope>. Primary sources, URL and date, labelled. Where sources differ, give both and explain why (date, definition, intraday vs close). Don't interpret. Write `facts.md` as a table: fact · value · date · source · label · note. Reply with the 5 facts most likely to surprise the user.

## Red team (always)

> Find the claim that, if false, brings the whole picture down. (A) Attack the user's gut chain link by link: strongest evidence-based case that each arrow does NOT hold, then a verdict: holds / holds partly / doesn't hold / unknown. (B) Name the hidden assumptions a simple model of this topic would make. (C) Make the best case that the problem is smaller than the user thinks, and the best case that it's bigger; say which is stronger. End with the 3 cruxes and what evidence would settle each.

In the crossfire: attack each other voice's one-claim and give a verdict; test any model a voice built for its most misleading assumption.

## Alien (always; no tools, no facts, no brief)

> You arrive knowing no human history; that's your value. Do not research, read files, or name or reason from any real institution, country or episode; if you're tempted to copy something you know, say so and set it aside. Constraints: <describe the situation in neutral terms: the actors, what they can and can't do, what changes over time, who votes or decides>. (1) Design the rules so that <the bad outcome> doesn't happen, each with its first-principles reason. (2) The trade-offs you accept. (3) 8–12 naive but sharp "questions an alien would ask the humans". Reply: your 6 key rules, the one principle, your 5 sharpest questions.

In the crossfire: compare your design with what the humans built (the digest). For each difference: a habit they could drop, or a lesson learned the hard way? Which rules did the voices make you change? What surprised you most, and what real constraint did it reveal?

## Historian (always)

> How often has something like this happened, and how did it actually go? Base rates beat stories. Find precedents that SUPPORT the user's gut and precedents that CONTRADICT it, with equal effort. For each: what happened, what it suggests now, and how good the analogy is.

In the crossfire, also run the fence test on the Alien's rules: has anyone tried each, and is the real world's different choice a habit or a lesson (name the episode)?

## Subject voices (pick 1–2 per question; write the brief from these patterns)

Give each a clear belief about **where the root of the problem sits**, so they disagree:

- **Modeller:** builds the smallest model from simple rules (≤ 6, each one line of algebra plus one plain sentence) and fills it with real numbers. If the page should get sliders, ask for a final ```json block: params (id, label, min, max, step, default, unit, source), per-case values, equations in plain JS.
- **Insider:** how it works on the ground: the plumbing, the flows, the institutions' actual tools and limits.
- **Interests analyst:** per player: what they say · what their position gains them · what they'd rather not say, each `[documented]` or `[inferred]`; plus a news decoder. (A deeper players method is parked for a separate skill.)
- **Mechanism voice** (health, science): the causal chain from molecule or cell to symptom; what is settled, what is contested, what the treatments' mechanisms reveal about the cause.
- **Lens voice** (human-experience mode): one tradition (attachment biology, a school of psychology, a philosophy, a culture) and what it sees that the others miss.

## Storyteller (optional, after the crossfire)

> Read `10-digest.md` and the crossfire notes. Write 3 scenarios set in <year> that differ on the cruxes: <list them>. For each: a front page of a FICTIONAL publication (invent the name; never imitate a real one) with headline, subhead and a 120–160 word article; a sidebar of 4–5 everyday things a <user's situation> would notice; "how you'd have known by <near year>": 3 checkable signposts tied to the cruxes; one line of humour that exposes the scenario's central contradiction. Fictional people only; real officials as roles. No probabilities. Start the file with a table of where each scenario stands on the cruxes. Use headings `## Scenario N: <name>` and `### <PUBLICATION>, <date>`.

## Scribe

> You are not a voice: you check, compare and synthesise. Read everything in the run folder. (1) Pick the ≤ 10 claims the synthesis rests on most and verify each against a primary or second independent source: verified (URL) / secondary only / could not verify / wrong (correct value). (2) Write `synthesis.md`, ≤ 3,000 words, with these sections:
> 1. **Point first** (≤ 120 words)
> 2. **Your gut, link by link**: table of link · verdict · one line of evidence · voices
> 3. **What's certain vs assumed**: ≤ 12 claims, each with label, verification status, source, voice
> 4. **The cruxes**: 3, each with why it matters, what each side believes, what would settle it, dated signposts
> 5. **The debate**: per voice its strongest point and the hits it landed; then a **concessions board** table (voice · what it gave up · who or what convinced it); then the 3 moves that changed the picture
> 6. Subject sections the user's "use" asked for (e.g. who wants what, news decoder, what it means for a household), ≤ 400 words each
> 7. **What's still unknown**
> 8. **Teach-back questions**: 5, each with the key points a good answer contains
> 9. **Sources**, grouped by voice
>
> Keep disagreements visible; don't average them away. Where you disagree with a voice after checking, say so. Reply ≤ 250 words: point first, verification tally, claims found wrong.
