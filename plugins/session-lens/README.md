# session-lens

A pane that shows what this session is doing and has used: Claude's to-do list, its crew of subagents as animated crabs, and the skills and tools it used. A crew band above the prompt follows the subagents while they work.

## What it does

Four sections that open and close on their own:

1. **To-do**: Claude's current task list. Each step is marked ○ pending, ● in progress (bold, in its "doing now" wording) or ✓ done (struck through). The header shows a count like "2 of 5", and a bar shows how far along the list is.
2. **Crew**: a beach where **Captain Clawd**, the main thread, always has the top lane. He walks toward his flag as Claude's own to-do list moves, says what the main conversation is doing ("Taking the wheel: register.tsx"), and sleeps while Claude waits for you. Each subagent of the session is a crab with a lane of its own, walking toward its flag as its progress climbs. That progress comes from the agent's own to-do list when it keeps one, else an estimate that only a finished crab completes. Each crab says what it is up to in a speech bubble, in character. Under the beach, a row per crab **at work** gives its name and role, task, progress, calls and time. The crabs keep the order they set out in, on the beach and in the list: the race is in how far each has walked. A crab that reaches 100% walks past its flag and stands there cheering for 3 seconds, then flies to the top of **Reported back**. That list shows how each run ended (done, failed or stopped), the crab's last line and how long it took, the latest to report back first. A crab that fails or is stopped reports back straight away.
3. **Skills**: each skill used, shown as `/name` with a use count. Skills a memory file pulls in at start (a CLAUDE.md import) are tagged **always loaded**.
4. **Tools**: each tool used, with a use count. Tools are grouped by their MCP server or connector, with the built-in tools in a group of their own, and can be listed flat instead. Sort by **Most used**, **Recent** or **A–Z**, and type in the filter to narrow the list. Calls that failed are counted and marked in red.

The counts are for this session only: only tools and skills that were actually used appear. Calls made by subagents count too. The to-do list follows the main conversation only. Your layout (which sections and groups are open, grouped or flat, the sort) is kept for your next session.

In the desktop app the rows are animated drawings. A step that is ticked off draws its check and strike-through. The step in progress pulses, with a sheen across its text. A tool or skill used for the first time flies into its list from the bottom. One that changes place, because its count passed another's or you changed the sort, flies to its new spot past the others, lit as it lands. Tool bars grow, and a count bumps when it goes up.

While a crew is out, a **crew band** sits just above the prompt. It shows their crabs, who is at work, and one bar of the crew's progress, so you can follow it without opening the pane. **Crew ×n** opens the lens at its crew, and **✕** hides the band until the next crew sets out. A new prompt sent with everyone back clears it.

The crabs are drawn in vector, each character in its own colour with a small mark of its role: a bandana, a cap, a tricorn, glasses and so on. On the beach, a crab at work scuttles along its lane toward its flag, footprints behind it, snipping its claws and blinking. Its line pops into a new bubble each time it does something new: "Spyglass on config.ts", "Hammering register.tsx into shape". A thinking crab has a dashed thought bubble with blinking dots, and one left without a call for a while taps a foot. Waves roll along the top of the beach. A crab that finishes cheers with a hop and sparkles past its flag, then flies down into **Reported back**, lit as it lands. A failed crab sees stars, and a stopped one falls asleep. A new crab flies in at the foot of **At work**. Each animation plays once, when its row changes; the rest of the pane stays still. The terminal draws the same sections in text.

### Using the pane

The first time, **To-do**, **Crew** and **Skills** are open and **Tools** is closed, showing only its summary ("12 tools · 80 calls"). Open it to see the tools grouped by server, sorted by **Most used**, with every server collapsed. A section with nothing in it yet shows only its header.

- Press a section's arrow or title (**▾ To-do**, **▾ Crew**, **▾ Skills**, **▸ Tools**) to close or open that section.
- In **Tools**, press a server's name to open or close that group. **⊞ Expand all** / **⊟ Collapse all** turns every group at once, and servers that show up later start the way you last chose. **By server** and **All tools** switch between grouped and flat. In the flat list each tool shows its server beside its name.
- While the filter holds text, every group that has a match is shown open. **✕ Clear** empties the filter.
- What you change is kept for your next session: open and closed sections and groups, grouped or flat, and the sort. The filter always starts empty.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install session-lens --marketplace marwansaab/Claude-Mods
```

Answer `y` to add the marketplace, then choose a scope.

**session-lens replaces [crab-crew](../crab-crew).** It has its own crew of crabs and its own crew band above the prompt, so with both installed you get two crews and two bands. Don't install crab-crew alongside it, and if you already have it, disable it:

```
claude plugin disable crab-crew@claude-mods
```

Then run `/reload-plugins` in any session that is already open: a disabled plugin keeps running there until the plugins are reloaded or a new session starts. Inside a session, `/plugin` does the same from its Installed tab and reloads when you close it.

## Commands

| Command | Does |
| --- | --- |
| `/lens` | Opens the pane, or closes it when it is open |

In the desktop app the pane also opens by itself the first time a session uses a tool or a skill, unless you closed it in your last session (see Settings).

## Settings

Set them in `/config`, or for a mod loaded with `--plugin-dir`, in `~/.claude/settings.json`:

```json
{ "pluginConfigs": { "session-lens": { "options": { "autoOpen": true, "crewBand": true } } } }
```

| Setting | Default | Effect |
| --- | --- | --- |
| `crewBand` | `true` | Show the crew band above the prompt while subagents are out. |
| `autoOpen` | `true` | In the desktop app, open the pane the first time a session uses a tool or a skill, unless you closed it (with its close mark or `/lens`) in your last session. In a terminal, the pane opens only with `/lens`. |

## How it works

- A `tool.call` hook lets each call run, then counts it unless it was denied. It never changes the call, and a failure inside it is swallowed.
- The to-do list is rebuilt from the plan tools the main conversation calls: `TodoWrite`, `TaskCreate` and `TaskUpdate`, and the desktop app's own task list (`update_plan`, with `advance`, `done` and `start`). The desktop app's closing `wrap_up` call ticks every step off.
- The crew comes from the subagents' own events. `agent.spawn` casts a crab by agent type: `general-purpose` is a Deckhand, `Explore` a Scout, `Plan` a Navigator, `claude-code-guide` a Professor, `statusline-setup` a Signaller and `fork` an Understudy. Any other type is always dealt the same one of the Cook, Sleuth, Wizard and Diver. A subagent's `turn.step` sets its crab thinking, its `tool.call`s say what it is doing and feed its to-do progress, and its `turn.complete` says how the run ended. A crab that is done stays on the beach for 3 s, and a timer then notes the crew's new order so it flies to the list. The main conversation's own `turn.step`, `tool.call` and `turn.complete` do the same for the captain. While a crab works, the pane is redrawn every 5 s so a crab left without a call is drawn waiting. The band above the prompt is a `ui.render` hook on `AbovePrompt`: it shows the crabs that set out or came back since the last prompt sent with no one out, and draws what Claude Code and other mods put in the band under its own, as the band is shared; it leaves the band to them when there are none, or when a survey is up. The cast, its lines and the progress estimate are adapted from this repository's [crab-crew](../crab-crew) mod. A crab's walk along its lane is pinned to when its progress moved, as every animation here is.
- A `skill.prompt` hook counts each skill as it is expanded for the model, whether typed as `/name`, called through the Skill tool, or preloaded.
- Group names come from the session's context breakdown (`$.session.usage({ breakdown: 'summary' })`). It gives the name `/mcp` lists for each server, so a claude.ai connector shows its name rather than its id. The same breakdown names the skills loaded through memory files. It is read when the session starts, when `/lens` opens the pane, and when a tool from a new server is first called.
- A resumed session's earlier calls are counted once, from its transcript. A `/clear` starts the counts over and keeps the pane's layout.
- Counts and the layout live in `$.state`, so a reload of the mod keeps them. The layout is also written to the mod's `$.store` on each change and read back when a session starts. So is whether you closed the pane last. A `ui.close` hook notes a close you make with the pane's close mark.
- After each change that can reorder a list (a call, a skill, a new sort), the mod notes every list whose order changed: its old order, its new one, and when. Each list (the skills, each server's tools, the flat list) is drawn as one picture, so a row can fly from its old slot to its new one. Lists are compared unfiltered, and nothing flies while the filter holds text.
- The desktop drawings are SVG with CSS animations. The pane is redrawn on every event of the session, and a redrawn picture would start its animations over. So each animation is pinned to the moment its row changed: a drawing made later shows it part-way through, or with no animation once it is over. The loops on the step in progress keep their phase from one drawing to the next. The app also keeps the pane's last drawing and may show it again (a new message, a re-layout) without asking the mod, which would replay an animation caught mid-way. So about 1.6 s after each change, once its animations are over, the mod asks for one more drawing, with nothing left to replay. Under `prefers-reduced-motion` every drawing shows its final state with no motion. Each has an `alt` text, and colours follow the light or dark theme.

## Known limits

- The crew starts empty in a resumed session: crabs come only from subagents that set out in it. It keeps the 40 latest crabs.
- Tool bars use a log scale that fills at 50 calls, so a row's bar depends on its own count alone. Compare the numbers rather than the bar lengths.
- A connector whose server name the context breakdown does not list shows as `Connector` plus the first characters of its id.
- A skill typed as `/name` in a resumed session's earlier turns is not counted; skills called through the Skill tool are.
- The mobile app draws no text field, so it has no filter there.
- Built on Claude Code's function-hook plugin API (early access), tested against Claude Code 2.1.307.

## Credits

- The idea of a pane listing what a chat has used, its to-do list, tools and skills side by side, comes from Ben AI's mods, shown in [this video](https://www.youtube.com/watch?v=bTqizdva04g) (its *chat-inventory* mod). session-lens takes the idea, not the code.
- The crew, its cast of characters, their lines, the walk toward the flag and the band above the prompt are adapted from this repository's [crab-crew](../crab-crew) mod.

## Licence

MIT, see the repository's [LICENSE](../../LICENSE).
