# ai-kit

A collection of reusable AI agent building blocks — skills, commands, MCPs, and tools — built for [Claude Code](https://claude.ai/code) and the Claude Agent SDK.

## What's in here

| Category | Description |
|---|---|
| `commands/` | Claude Code slash commands |
| `mods/` | Claude Code mods: plugins of function hooks that add panes, bands and reactions |
| `skills/` | Reusable agent skills |
| `mcps/` | MCP server implementations |

Each item lives in its own subfolder with a README covering what it does, how to install it, and any configuration needed.

## Commands

### [pr-watch](commands/pr-watch/)

Monitor pull request status across one or more GitHub repositories. Polls for status changes and surfaces review events, CI results, and merge readiness.

## Mods

### [space-mod](mods/space-mod/)

A band above the prompt, drawn like a 90s Sierra adventure game: the Claude robot and you on a spaceship deck, with moods, banter balloons, red alerts and confetti showing how the collaboration is going.

```
/plugin install space-mod --marketplace anneveling/ai-kit
```
