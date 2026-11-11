# crew-dispatch

A routing table for subagents: you choose which model and effort each agent type gets, in `/config` or on a dispatch board you open with `/ms-crew-dispatch`, and the board lists what each subagent of the session ran on and why. Just after install every row is `auto`, so nothing changes until you pick something.

## What it does

- **Routes the model.** When Claude starts a subagent without naming a model, the row for that agent type picks one: an alias (`haiku`, `sonnet`, `opus`, `fable`), `inherit` (the parent's model), or `auto` (the agent's own definition, else the session's default). When Claude names a model in its Agent call, that model stands.
- **Routes the effort.** Each model request of a routed subagent is sent with its row's effort (`low` to `max`), or with what its definition or the session sets when the row is `auto`. Claude's Agent call has no effort parameter, so the row always applies. Effort is read on every request, so a change reaches subagents that are already running. A model change applies from the next spawn.
- **Covers ordinary subagents only.** It leaves forks, workflow agents, teammates and resumed runs as they are.
- **Falls back on a bad model.** When a row's model cannot start a subagent (for example, an alias your account or provider doesn't offer), the spawn is tried again as if unrouted. The row is then marked on the board, its model is skipped for the rest of the session, and a one-line note goes in the transcript. The note is a system row the model never reads.

Who wins, highest first:

| Model | Effort |
| --- | --- |
| Claude's Agent call | your row |
| your row | the agent's definition |
| the agent's definition | the session's default |
| the session's default | |

### Rows

- One row for each built-in type: `general-purpose`, `claude`, `Explore`, `Plan`, `claude-code-guide` and `statusline-setup`.
- **any other type** catches every type without a row of its own.
- Named rows for any other type, such as a plugin's agent. A type the session offers the model shows up on the board by itself, set to *as other* until you pick something. A named row matches the type with or without its plugin prefix (`review-desk:reviewer` or `reviewer`). A field left on *as other* follows the any-other-type row.

### The board

`/ms-crew-dispatch` opens a pane with three parts:

- **Routing** on or off. When it is off, every subagent runs as it would without the mod, and your rows are kept.
- **Rows**: a model picker and an effort picker for each row. A pick is written to the mod's settings, so `/config` and the board always agree.
- **This session**: each subagent, newest first, with its type, task, the model and effort it ran on, where each came from (Claude's call, your row, its default, a fallback, or routing off) and the row it was routed by.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install crew-dispatch --marketplace marwansaab/Claude-Mods
```

Answer `y` to add the marketplace, then choose a scope. To see each crab's effort beside its model, install [session-lens](../session-lens) 0.7.0 or later alongside it.

## Commands

| Command | Does |
| --- | --- |
| `/ms-crew-dispatch` | Opens the dispatch board, or closes it when it is open |

## Settings

Set them in `/config` or on the board. For a mod loaded with `--plugin-dir`, set them in `~/.claude/settings.json`:

```json
{ "pluginConfigs": { "crew-dispatch": { "options": { "exploreModel": "haiku", "exploreEffort": "low", "planEffort": "high", "namedTypes": "review-desk:reviewer=sonnet:high" } } } }
```

| Setting | Default | Effect |
| --- | --- | --- |
| `routing` | `true` | Apply the table to new subagents and their requests. |
| `generalPurposeModel` / `generalPurposeEffort` | `auto` | The `general-purpose` row. |
| `claudeModel` / `claudeEffort` | `auto` | The `claude` row. |
| `exploreModel` / `exploreEffort` | `auto` | The `Explore` row. |
| `planModel` / `planEffort` | `auto` | The `Plan` row. |
| `guideModel` / `guideEffort` | `auto` | The `claude-code-guide` row. |
| `statuslineModel` / `statuslineEffort` | `auto` | The `statusline-setup` row. |
| `otherModel` / `otherEffort` | `auto` | Any type without a row of its own. |
| `namedTypes` | `""` | Rows for other types, `type=model:effort`, separated by commas. A field left out follows the `other` row. |

Model settings take `auto`, `inherit`, `haiku`, `sonnet`, `opus` or `fable`. Effort settings take `auto`, `low`, `medium`, `high`, `xhigh` or `max`.

## How it works

- An `agent.spawn` hook looks up the subagent's row before the engine resolves its model. When Claude named no model and the row names one, it passes the spawn on with that model (`inherit` is sent as the parent's model id). If that spawn is refused or fails, it tries once more unrouted. Only when the unrouted spawn starts is the row's model blamed: it is noted in `$.state` and skipped for the session, and a system row is added with `$.session.append`. A spawn refused either way returns the refusal untouched.
- A `turn.step` hook sets the effort on each model request of a subagent it recorded, from its row as the settings stand at that moment. It sends no effort to a model that takes none, and it never touches the main conversation's requests.
- The settings are read live with `$.config.list()` on every spawn, request and drawing. The board writes them with `$.config.set`, and the named rows go into `namedTypes`.
- An `agent.offer` hook notes the agent types the session offers, so each one has a row on the board.
- The board is a `ui.render` hook on its pane, drawn in text and native controls (Button, Select) on every surface, with no animation.
- Every hook is wrapped so that a failure in the mod's own bookkeeping cannot fail a spawn, a request or the session. The spawn hook passes the spawn through when it fails.

## Known limits

- The engine doesn't tell a mod which model or effort an agent's definition sets, so a row that names a model overrides it. Leave the row on `auto` to keep the definition's choice.
- The fallback covers a model the engine refuses when the subagent starts. A model that starts but then fails on its first request is not retried; that request fails as it would without the mod.
- On models that take effort per message, a new level counts from the subagent's next request with new input, not from one that only returns tool results.
- A number of the effort budget is not offered: public builds don't send one.
- session-lens shows a crab's effort as its `turn.step` hook sees it. When session-lens's hook runs before this mod's, it shows the level from before routing.
- The board keeps the session's 60 latest subagents.
- Built on Claude Code's function-hook plugin API (early access), tested against Claude Code 2.1.319.

## Licence

MIT, see the repository's [LICENSE](../../LICENSE).
