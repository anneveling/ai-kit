# ai-kit

A collection of reusable AI agent building blocks — skills, commands, MCPs, and tools — built for [Claude Code](https://claude.ai/code) and the Claude Agent SDK.

## What's in here

| Category | Description |
|---|---|
| `commands/` | Claude Code slash commands |
| `skills/` | Reusable agent skills |
| `mcps/` | MCP server implementations |

Each item lives in its own subfolder with a README covering what it does, how to install it, and any configuration needed.

## Commands

### [pr-watch](commands/pr-watch/)

Monitor pull request status across one or more GitHub repositories. Polls for status changes and surfaces review events, CI results, and merge readiness.

## Skills

### [retro](skills/retro/)

A short retro between you and Claude (not a team retrospective) on how the two of you work together. Every few days it reads your past sessions, spots friction (confusion, back-and-forth, wrong assumptions, caving under pushback, rework) and proposes changes to Claude's instructions and skills, plus habits you could try yourself. Nothing changes until you pick what to adopt.

It comes in two parts: the skill, and a few lines you paste into your global `CLAUDE.md`. With those lines, Claude names the friction at the end of a bumpy session ("The plan changed three times before we agreed on scope. Noted for the next retro, or we can do one now.") and suggests a retro once one is due, at most every five days. Nothing is logged between retros: a local script reads Claude Code's own transcripts, so a retro reads tens of thousands of tokens, not the millions in the raw files. Your own extras (an inbox, extra checks) go in `~/.claude/retro.local.md`, so they survive updates. Invoke with `/retro`.
