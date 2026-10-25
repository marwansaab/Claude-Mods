# session-lens

A pane that shows what this session is doing and has used, in three sections that open and close on their own:

1. **To-do**: Claude's current task list. Each step is marked ○ pending, ● in progress (bold, in its "doing now" wording) or ✓ done (struck through). The header shows a count like "2 of 5", and a bar shows how far along the list is.
2. **Skills**: each skill used, shown as `/name` with a use count. Skills a memory file pulls in at start (a CLAUDE.md import) are tagged **always loaded**.
3. **Tools**: each tool used, with a use count. Tools are grouped by their MCP server or connector, with the built-in tools in a group of their own, and can be listed flat instead. Sort by **Most used**, **Recent** or **A–Z**, and type in the filter to narrow the list. Calls that failed are counted and marked in red.

The counts are for this session only: only tools and skills that were actually used appear. Calls made by subagents count too. The to-do list follows the main conversation only. Your layout (which sections and groups are open, grouped or flat, the sort) is kept for your next session.

In the desktop app the rows are animated drawings. A step that is ticked off draws its check and strike-through. The step in progress pulses, with a sheen across its text. A tool or skill used for the first time flies into its list from the bottom. One that changes place, because its count passed another's or you changed the sort, flies to its new spot past the others, lit as it lands. Tool bars grow, and a count bumps when it goes up. Each animation plays once, when its row changes; the rest of the pane stays still. The terminal draws the same sections in text.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install session-lens --marketplace marwansaab/Claude-Mods
```

Answer `y` to add the marketplace, then choose a scope.

## Commands

| Command | Does |
| --- | --- |
| `/lens` | Opens the pane, or closes it when it is open |

In the desktop app the pane also opens by itself the first time a session uses a tool or a skill, unless you closed it in your last session (see Settings).

## The pane

The first time, **To-do** and **Skills** are open and **Tools** is closed, showing only its summary ("12 tools · 80 calls"). Open it to see the tools grouped by server, sorted by **Most used**, with every server collapsed. A section with nothing in it yet shows only its header.

- Press a section's arrow or title (**▾ To-do**, **▾ Skills**, **▸ Tools**) to close or open that section.
- In **Tools**, press a server's name to open or close that group. **⊞ Expand all** / **⊟ Collapse all** turns every group at once, and servers that show up later start the way you last chose. **By server** and **All tools** switch between grouped and flat. In the flat list each tool shows its server beside its name.
- While the filter holds text, every group that has a match is shown open. **✕ Clear** empties the filter.
- What you change is kept for your next session: open and closed sections and groups, grouped or flat, and the sort. The filter always starts empty.

## Settings

| Setting | Default | Meaning |
| --- | --- | --- |
| `autoOpen` | `true` | In the desktop app, open the pane the first time a session uses a tool or a skill, unless you closed it (with its close mark or `/lens`) in your last session. In a terminal, the pane opens only with `/lens`. |

## How it works

- A `tool.call` hook lets each call run, then counts it unless it was denied. It never changes the call, and a failure inside it is swallowed.
- The to-do list is rebuilt from the plan tools the main conversation calls: `TodoWrite`, `TaskCreate` and `TaskUpdate`, and the desktop app's own task list (`update_plan`, with `advance`, `done` and `start`). The desktop app's closing `wrap_up` call ticks every step off.
- A `skill.prompt` hook counts each skill as it is expanded for the model, whether typed as `/name`, called through the Skill tool, or preloaded.
- Group names come from the session's context breakdown (`$.session.usage({ breakdown: 'summary' })`). It gives the name `/mcp` lists for each server, so a claude.ai connector shows its name rather than its id. The same breakdown names the skills loaded through memory files. It is read when the session starts, when `/lens` opens the pane, and when a tool from a new server is first called.
- A resumed session's earlier calls are counted once, from its transcript. A `/clear` starts the counts over and keeps the pane's layout.
- Counts and the layout live in `$.state`, so a reload of the mod keeps them. The layout is also written to the mod's `$.store` on each change and read back when a session starts. So is whether you closed the pane last. A `ui.close` hook notes a close you make with the pane's close mark.
- After each change that can reorder a list (a call, a skill, a new sort), the mod notes every list whose order changed: its old order, its new one, and when. Each list (the skills, each server's tools, the flat list) is drawn as one picture, so a row can fly from its old slot to its new one. Lists are compared unfiltered, and nothing flies while the filter holds text.
- The desktop drawings are SVG with CSS animations. The pane is redrawn on every event of the session, and a redrawn picture would start its animations over. So each animation is pinned to the moment its row changed: a drawing made later shows it part-way through, or with no animation once it is over. The loops on the step in progress keep their phase from one drawing to the next. The app also keeps the pane's last drawing and may show it again (a new message, a re-layout) without asking the mod, which would replay an animation caught mid-way. So about 1.6 s after each change, once its animations are over, the mod asks for one more drawing, with nothing left to replay. Under `prefers-reduced-motion` every drawing shows its final state with no motion. Each has an `alt` text, and colours follow the light or dark theme.

## Limits

- Tool bars use a log scale that fills at 50 calls, so a row's bar depends on its own count alone. Compare the numbers rather than the bar lengths.
- A connector whose server name the context breakdown does not list shows as `Connector` plus the first characters of its id.
- A skill typed as `/name` in a resumed session's earlier turns is not counted; skills called through the Skill tool are.
- The mobile app draws no text field, so it has no filter there.
- Built on Claude Code's function-hook plugin API (early access), tested against Claude Code 2.1.307.
