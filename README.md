# Claude Mods

Mods for [Claude Code](https://claude.com/claude-code): live panes, bands above the prompt and hooks, each written as a plugin of function hooks. They run in the terminal and in the desktop app's Code tab.

This repository is also a plugin marketplace, so you can install any mod with one command.

## Mods

| Mod | What it does |
| --- | --- |
| [crab-crew](plugins/crab-crew) | A crew panel for subagents. Each agent type is played by a crab character with its own role, look and lines, animated by its status and progress. Works with the standard agents; no skills needed. |
| [obsidian-cli-mcp-tool-stats](plugins/obsidian-cli-mcp-tool-stats) | Usage stats for the [obsidian-cli-mcp](https://github.com/marwansaab/obsidian-cli-mcp) server: calls, estimated tokens, errors and latency per tool, with hints on heavy results, repeat calls, error patterns and unused schemas. Kept across sessions. |

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install crab-crew --marketplace marwansaab/Claude-Mods
```

Answer `y` to add the marketplace, then choose a scope (user scope loads the mod in every session). A mod installed this way also loads in the desktop app's Code tab.

To update later: `claude plugin update crab-crew`, then `/reload-plugins` in a running session.

## Requirements

These mods use Claude Code's function-hook plugin API, which is in **early access** and may change between releases. They were built and tested against Claude Code **2.1.293**. If a mod stops loading after an update, check the issues or open one.

## Repository layout

```
.claude-plugin/marketplace.json   the marketplace: one entry per mod
plugins/<mod>/                    one folder per mod, self-contained
  .claude-plugin/plugin.json      the mod's manifest
  hooks/hooks.json                names the hooks module
  hooks/*.ts(x)                   the hooks module and its helpers
  types/index.d.ts                the mod's state contract
  tests/*.test.ts                 tests run by `claude plugin test`
  docs/                           screenshots for the mod's README
  README.md                       what the mod does and how to use it
```

Contributing or developing a mod: see [CLAUDE.md](CLAUDE.md).

## Licence

[MIT](LICENSE) © 2026 Marwan Saab.

Claude and Claude Code are trademarks of Anthropic. These mods are independent community projects, not made or endorsed by Anthropic.
