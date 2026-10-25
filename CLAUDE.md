# Claude Mods: working in this repository

This repository holds several independent Claude Code mods (plugins of function hooks) and the marketplace that lists them. It is **public and MIT-licensed**: everything committed here is published.

## Layout

- `.claude-plugin/marketplace.json` lists every mod. **Always add a mod here when you create it**, with `source: "./plugins/<mod>"`, and keep its `description` in step with the mod's `plugin.json`.
- `plugins/<mod>/` holds one mod, self-contained: never import across mod folders. Shared code is copied, or becomes its own mod that others list under `dependencies`.
- `README.md` at the root indexes the mods. **Add a row to its *Mods* table for each new mod.**

Inside a mod:

| Path | Holds |
| --- | --- |
| `.claude-plugin/plugin.json` | `name` (= the folder name), `version`, `description`, `author`, `homepage`, `repository`, `license: "MIT"`, `types`, `userConfig` |
| `hooks/hooks.json` | `{ "modules": ["./register.tsx"] }`: one module |
| `hooks/register.tsx` | `export const register: Register = (on, options) => { ... }` |
| `hooks/*.ts` | helpers, imported extensionless (`./crew`) |
| `types/index.d.ts` | the `$.state` contract: `declare module 'claude-code' { interface PluginState { '<mod>': { ... } } }` |
| `tests/*.test.ts` | `claude plugin test` suites |
| `docs/` | screenshots used by the mod's README |
| `README.md` | what it does, install, commands, settings, how it works, limits |

`plugins/*/.claude-plugin/types/` is written by Claude Code on every load. It is git-ignored; never edit it or commit it.

## Adding a mod

1. Create `plugins/<mod>/` with the files above; `name` in `plugin.json` equals the folder name.
2. Add it to `.claude-plugin/marketplace.json` and to the *Mods* table in `README.md`.
3. Write its `README.md` with these headings, in this order (the mod READMEs here all follow it):
   - `# <mod>`, then a short lead paragraph: what the mod is, in a sentence or two (a screenshot may follow).
   - `## What it does`: the features. Anything mod-specific (a cast of characters, a pane's controls, hints) is a `###` subsection here, not a heading of its own.
   - `## Install`: the `/plugin install <mod> --marketplace marwansaab/Claude-Mods` line, and anything to do before or after (a mod it replaces, a reload).
   - `## Commands`: a `| Command | Does |` table, tools for Claude included.
   - `## Settings`: where to set them (`/config`, or `pluginConfigs` in `~/.claude/settings.json`, with a JSON example), then a `| Setting | Default | Effect |` table keyed by the `userConfig` key.
   - `## How it works`: the hooks and state, briefly.
   - `## Known limits`.
   - `## Credits` when the mod draws on someone else's work, then `## Licence`: MIT, linking the root `LICENSE`.
4. Validate, type-check and test (below) before committing.

## Developing a mod

- **Run it from this folder:** `claude --plugin-dir plugins/<mod>`. For the desktop app, name the folder in `CLAUDE_CODE_PLUGIN_DIRS` in `~/.claude/settings.json` → `env`. Interactive sessions reload the module on save.
- **Or install it from this checkout:** `claude plugin marketplace add <path to this repo>`, then `claude plugin install <mod>@claude-mods`. A folder marketplace is read in place, so an edit plus `/reload-plugins` picks it up with no reinstall.
- **Check it:** `claude plugin validate plugins/<mod>` (manifest, hooks, state contract), `claude plugin test plugins/<mod>`, and `tsc -p plugins/<mod>` once the mod has loaded (the engine lays a `tsconfig.json` and the API types beside it). Use the `claude` build you run the mod in; an older CLI on PATH rejects the function-hook manifest.
- The API is early access. The authority is the declaration file the engine writes into `.claude-plugin/types/claude-code/index.d.ts`; grep it for an event or noun before guessing.

## Rules for mods

- **Never break the session.** A mod that observes (rather than guards) wraps its side effects so a failure cannot fail the tool call, spawn or turn it watches, and gives every gating hook a pass-through `.catch(($, e, next) => next(e))`.
- **Keep drawing state in `$.state`**, declared in `types/index.d.ts`; module variables reset on every reload. Never write state from a `ui.render` hook.
- **Draw for both the terminal and the desktop.** Check `e.surface` / `'Svg' in ui`, and give every `Svg` a meaningful `alt`. Test on `['terminal', 'desktop']`.
- **Respect `prefers-reduced-motion`** in every animated SVG.
- **Depend on nothing implicit.** A mod works with the standard agents and tools; if it needs another plugin, list it under `dependencies`.
- **Bump `version` (semver)** in `plugin.json` with every user-visible change; installed copies update only on a new version.
- **Never commit secrets, tokens, personal data, machine paths or employer material.** Screenshots must not show private repositories, file paths or conversation content.
- **Keep the licence intact.** New files are MIT under the root `LICENSE`. Code adapted from elsewhere must be MIT-compatible and credited in the mod's README.

## Commits

- Scope a commit to one mod where possible, prefixed with its name: `crab-crew: add sleep pose`.
- Commit only what was asked; never push without the owner's say-so.
