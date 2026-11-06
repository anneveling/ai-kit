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

### [panel](skills/panel/)

Put a big question to a panel of independent voices: each researches alone, then they attack, concede and update in a crossfire, and a scribe checks the load-bearing sources. Ends in a three-layer page. Invoke with `/panel`.
