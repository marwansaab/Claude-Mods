# obsidian-cli-mcp-tool-stats

Usage stats for the [obsidian-cli-mcp](https://github.com/marwansaab/obsidian-cli-mcp) server, live in a pane. For each of its tools you see how often it is called, how many tokens its arguments and results cost, how often it fails and how long it takes. Hints point at what to tune: heavy results, repeat calls, recurring errors and schemas that sit in context unused. Totals are kept across sessions, so tools nobody calls and errors that keep coming back stand out over time.

## What it does

Calls from the main session and from subagents both count. Other MCP servers and the built-in tools are ignored.

### The pane

Press the tab buttons, or their hotkeys while the pane has focus:

- **1 Tools**: one row per tool, with calls (and how many came from subagents), errors and denials, ≈tokens sent and read, the average and largest result, average and slowest time, and when it was last used. Sort it by **t**okens, **c**alls, **e**rrors or ti**m**e. On the desktop a bar chart of the top tools sits above the table, its error share in red.
- **2 Errors**: errors grouped by pattern, with paths, numbers and quoted values masked so the same fault on different notes counts as one, followed by the latest failures and denials with their arguments.
- **3 Hints**: what to tune, the most worth acting on first (●●●).
- **4 History**: every session so far, per tool, plus the tools never called.

**r** re-reads the schema costs. **y** copies the whole report as Markdown.

### Hints

| Hint | When it shows |
| --- | --- |
| Heavy results | A tool's results average more than the threshold, or one result is four times it. Says what to ask for instead: for `read`, `outline` and then `read_heading`. |
| Repeat calls | The same tool called with the same arguments more than once, and the tokens the repeats re-read. |
| Error patterns | A tool fails 20% of the time or more (three calls at least), or hits the same error twice. |
| Unused schemas | Tool schemas loaded into context but not called this session, with their token cost per request. After three sessions, tools never called at all. |
| Slow calls | A tool averages longer than the slow threshold. |
| Permission denials | A tool was denied, so an allow or deny rule would save the prompt. |

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install obsidian-cli-mcp-tool-stats --marketplace marwansaab/Claude-Mods
```

Answer `y` to add the marketplace, then choose a scope.

## Commands

| Command | Does |
| --- | --- |
| `/cli-mcp-tool-stats` | Opens the stats pane, or closes it when it is open |
| `/cli-mcp-tool-stats report` | Writes the full report into the conversation as Markdown, so Claude can read it and act on it |
| `/cli-mcp-tool-stats reset` | Starts this session's figures over; what was counted so far stays in the history |
| `/cli-mcp-tool-stats forget` | Clears the history of earlier sessions |

## Settings

Set them in `/config`, or for a mod loaded with `--plugin-dir`, in `~/.claude/settings.json`:

```json
{ "pluginConfigs": { "obsidian-cli-mcp-tool-stats": { "options": { "server": "obsidian-cli-mcp", "heavyResultTokens": 2000, "slowCallMs": 3000, "keepHistory": true } } } }
```

| Setting | Default | Effect |
| --- | --- | --- |
| `server` | `obsidian-cli-mcp` | The server tracked, as `/mcp` names it |
| `heavyResultTokens` | `2000` | Average result size, in tokens, above which a tool counts as heavy |
| `slowCallMs` | `3000` | Average time, in ms, above which a tool counts as slow |
| `keepHistory` | `true` | Keep per-tool totals and error patterns across sessions |

## How it works

- A `tool.call` hook wraps each call to `mcp__obsidian-cli-mcp__*` (a plugin-provided copy of the server, `mcp__plugin_…_obsidian-cli-mcp__*`, matches too). It records the arguments, the result text the model read, whether the call errored or was denied, and which agent made it. The hook never changes the call, and a failure inside it is swallowed.
- Timing comes from the engine's PostToolUse `duration_ms`, which leaves out time spent waiting on a permission prompt. When that is missing the mod falls back to wall time.
- Schema costs come from the session's context breakdown (`$.session.usage({ breakdown: 'summary' })`), read when the pane opens and on **r**.
- Session figures live in `$.state`. The history is written to the mod's `$.store` once a minute and when the session ends. Each write replaces the whole record, so a reload never counts a call twice. A `/clear` folds the session into the history and starts again.
- The pane draws Markdown tables on every surface. The desktop adds a static SVG chart with an `alt` text and no animation.

## Known limits

- **Token counts are estimates** of about four characters a token, from the argument JSON and the result text. They show which tools cost most, not exact billing. A result stays in context until compaction, so a heavy result costs more than its first read.
- Repeat detection compares the arguments exactly. Two reads of the same note written differently count as different calls.
- History keeps per-tool totals and up to 60 error patterns, not individual calls. The pane keeps the last 200 calls of a session.
- Schema costs list only tools in the current context breakdown. While tool schemas load on demand, a schema that hasn't been searched for costs nothing yet and is not flagged as loaded but unused.
- Built on Claude Code's function-hook plugin API (early access), tested against Claude Code 2.1.295.

## Licence

MIT, see the repository's [LICENSE](../../LICENSE).
