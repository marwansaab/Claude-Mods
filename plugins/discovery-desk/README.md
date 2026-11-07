# discovery-desk

A desk inside Claude Code for polishing low-fidelity UX prototype journeys. You open a journey in the panel (`/discovery`), step through it on iOS or Android, and answer its open questions, proposed decisions and ADRs on cards Claude puts up. When you submit, Claude gets the answers back with the order to apply them: the record (an Obsidian vault, a catalogue, ADR notes) first, then the prototype that mirrors it.

It reads prototypes built the way a *register plus journey pages* kit builds them: a `prototype.js` that sets `window.PROTOTYPE = {…}` (initiative, personas, surfaces, journeys, and the questions it mirrors), and one HTML page per journey that calls `Kit.journey({…})`. It reads both as data and never runs them or writes to them.

## What it does

- **A desk of walks and initiatives.** The home lists the walks waiting for you and the ones you submitted, then every initiative with a prototype, with its counts of open questions, proposals and decisions. The status line shows the walks waiting and the open initiative's counts.
- **The kit's hub, on the initiative page.** Tabs for the hub's views:
  - **Journeys**, in story-map order, with persona, status, steps, walked and undecided counts.
  - **Experience map**: every surface, who draws it and its API on each phone, and the journeys that show it.
  - **Personas**, with a *proposed persona* tag until real people back them.
  - **Questions**: the register's questions, decisions and ADRs, filtered by open and proposed, decided, set aside or all. Each opens the journey steps that show it.
  - **Story**: the hub's core loop as an animated flow, the README's story section, and every sentence the journeys label a placeholder.
  - **Progress**: per journey, chips decided against chips still waiting.
- **A journey player.** You step through a journey with the context the kit shows beside the phone: persona, use case, trigger, preconditions, outcome, what differs between iOS and Android, story-map steps and surfaces. Each step shows its title, the screen it is on, its caption, its chips and its callouts.
- **Cards for each open question, proposed decision and ADR**, published by Claude and framed by the desk from the register. Each card shows the item's status, the journey steps that show it, what differs on each phone, the evidence and the linked risks, assumptions and experiments.
- **Checks, as findings on the desk.** **Run checks** on an initiative runs the desk's own checks and, when you name it, the project's own validator. What they find goes on the desk as one walk of finding cards, for you to accept or reject.
  - The desk checks: surfaces nobody draws, a journey using a surface that is not in the surfaces table, chips the register does not list, gendered pronouns in captions, wording that suggests value leaves the product, and figures shown without being called placeholders.
  - The validator's `ERROR` and `warn` lines become findings, and the ones that name the record are marked as drift.
  - The same checks run by themselves at the end of a turn in which Claude edited a prototype; the status line shows the result.
- **Drift shown side by side.** A drift finding quotes the prototype and the record note it differs from. The desk refuses a finding whose quote is not in the prototype word for word; with `vaultRoot` set, it also checks the record quote against the note on disk. Accepting one tells Claude to fix the prototype toward the record.
- **A vault-first guard.** When Claude edits `prototype.js` or a journey page before anything has been written to the record in that turn, the desk reminds Claude of the rule, or with `guardMode: block` refuses the edit.
- **Stale walks flagged.** A walk keeps fingerprints of the register, its journeys' pages and the catalogue note. When one changes after publishing, the walk says its cards may be out of date and offers to ask Claude to publish it again.
- **Ask Claude about any card.** Each card has its own short chat, and Claude's answers come back onto the card with their sources.
- **Saved as you go.** Answers go to `draft.json`; your step notes, walked ticks and raised questions go to `notes/<initiative>.json`.
- **Submit, and Claude applies it in order.** The outcome lists every answer, the questions you raised, your step notes, a drafted polishing-log line and the order to apply them in. The hand-off asks Claude to put its write plan on the desk for your yes or no before it writes, and a closing checklist after.

### The journey player

| Control | Key | Does |
| --- | --- | --- |
| iOS / Android | | Switches the phone. Steps that play on one phone only are marked; switching lands on the nearest step |
| ‹ Previous, Next › | `k`, `j` | One step back or on |
| Next chip » | `n` | Jumps to the next step with an open question or a proposal: the polishing walk |
| ▶ Play | `p` | Moves on every few seconds and stops at the last step |
| ⟲ Restart | `r` | Back to the first step |
| Walked | `w` | Ticks the step as walked on this phone; the ring counts them |
| All / Captions only / Chips only / Hide callouts | | What a step shows |
| ▸ Map | `m` | The whole journey on this phone at a glance: each step's title, chips and colour, and whether it was walked |
| Note on this step | | Your note, handed over with the next walk you submit |
| Raise a question here | | A new open question, numbered after the register's highest. It waits on the initiative page until you hand it to Claude or submit a walk |
| 📱 Open on iOS / Android | | Asks Claude to open this step of the real page in the browser pane |
| ✻ Polish this journey | | Asks Claude to put the journey's undecided chips up as a walk |

The keys work while the panel has the focus.

### Cards

| Card | You |
| --- | --- |
| **Question** (`Q-NN`) | pick an option (Claude's recommended one is marked) or write an answer, set its status (leave open, decided, deferred, withdrawn), and tick *make it an ADR* when the answer has alternatives worth recording |
| **Decision** (`D-NN`) | approve, approve with changes, or reject, with the owner's call |
| **ADR** | decide it in place, decide with changes to its clauses, or keep it proposed |
| **Plan** | say yes or no to each row of a write plan or a closing checklist, then go ahead or cancel |
| **Proposal** | accept, accept with changes to the wording, or reject a new question or decision that someone proposed (a journey-building agent, Claude); accepted ones go into the record first |
| **Read-through** | read a discovery note section by section, with "Your call" flags, a note and a *Reviewed* tick per section |
| **Finding** | accept (for drift: fix toward the record), reject or discuss, with a reply; the prototype's words and the record's are shown |

Any walk can be submitted as a **plan only**: tick it beside *Submit*, and Claude writes nothing; it puts the write plan on the desk and outlines the changes instead.

### Authoring help

- **＋ New initiative** on the home asks for an id, a name, the story map and feature set ids, a pitch and the phone, then asks Claude to scaffold the prototype with the project's script (`scaffold`), after the record's discovery notes exist and with the write plan shown first.
- **Review the journey set** asks Claude to put the initiative's journeys up as a plan, one row per journey: keep, change, add or drop.
- **Read the discovery notes** asks Claude to put the overview, personas, story map and feature set up as read-throughs.
- **Proposals from agents:** the agents that build journeys hand their new questions and decisions to Claude, who puts them up as proposal cards, so nothing reaches the record before you accept it.

Chips and frames keep the kit's colours: purple for an open question, blue for a proposal, green for a decision.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install discovery-desk --marketplace marwansaab/Claude-Mods
```

Answer `y` to add the marketplace, then choose a scope. A mod installed this way also loads in the desktop app's Code tab. It works beside review-desk; neither needs the other.

## Commands

| Command | Does |
| --- | --- |
| `/discovery` | Opens the discovery desk, or closes it when it is open |
| `publish_walk` (tool for Claude) | Puts a walk on the desk: question, decision, ADR, plan, finding, proposal and read-through cards for one initiative. The desk refuses a walk with a list of what to fix, for example a journey not in the register, or a question card whose id reads as a decision |
| `list_walks` (tool for Claude) | Lists the initiatives the desk can see and its walks, with the path of each outcome |
| `answer_question` (tool for Claude) | Puts Claude's answer to a question you asked from a card back on that card |

To start, open a journey and press **Polish this journey**, or ask Claude something like *"put INIT-005's J02 open questions on the discovery desk"*.

## Settings

Set them in `/config`, or for a mod loaded with `--plugin-dir`, in `~/.claude/settings.json`:

```json
{ "pluginConfigs": { "discovery-desk": { "options": { "folder": "Discovery", "prototypeRoot": "", "defaultOs": "ios" } } } }
```

| Setting | Default | Effect |
| --- | --- | --- |
| `folder` | `Discovery` | The folder in the project, relative to its root, that holds `pending/`, `reviewed/` and `notes/` |
| `prototypeRoot` | _(the project root)_ | Where to look for prototypes: each folder under it with a `prototype.js` or a `UX Prototype/prototype.js` is an initiative. Relative to the project root, or absolute |
| `vault` | _(the register's)_ | The vault the hand-off names as the record. Empty: `initiative.vault` from `prototype.js` |
| `defaultOs` | `ios` | The phone a journey opens on: `ios` or `android` |
| `autoOpen` | `true` | Opens the panel on a new walk, unless you are in the middle of another one |
| `handOff` | `true` | On submit, queues a prompt asking Claude to apply the outcome |
| `selectableText` | `true` | On the desktop, draws card and caption text so it can be selected; off draws it as the app's own text |
| `validator` | _(none)_ | The project's own prototype check, run from the project root with the prototype folder added, for example `node .claude/skills/<skill>/scripts/validate_prototype.js`. Its `ERROR` and `warn` lines become findings |
| `validatorOffline` | `--no-vault` | Arguments that run the validator without the record, behind **Run without the record**. Empty: no such button |
| `vaultRoot` | _(none)_ | The vault's folder on disk, read only: drift quotes are checked against its notes, and the catalogue is fingerprinted |
| `autoValidate` | `true` | Runs the checks at the end of a turn in which Claude edited a prototype |
| `guardMode` | `warn` | The vault-first guard: `off`, `warn` (Claude is reminded) or `block` (the edit is refused) |
| `vaultWriteTools` | the obsidian-cli-mcp write tools | A pattern for the tools that write the record; a call to one counts as the record written this turn |
| `valueWords` | cash out, redeem, gift cards… | A pattern for wording that suggests value leaves the product. Empty: not checked |
| `figurePattern` | prices and coin counts | A pattern for figures a journey should call placeholders. Empty: not checked |
| `kitFolder` | _(none)_ | Where the shared prototype kit lives; **Open on iOS / Android** tells Claude to start the kit's server from there. Empty: the project's launch configuration names the server |
| `scaffold` | _(none)_ | The project's script that creates a new initiative's prototype folder, named to Claude by **New initiative**. Empty: Claude finds the project's own way |
| `questionPrefix`, `decisionPrefix`, `adrPrefix` | `Q-`, `D-`, `ADR-` | How the register's ids start |
| `questionStatuses` | `open, decided, deferred, withdrawn` | A question's status words: the undecided one first, the decided one second |
| `decisionStatuses` | `proposed, decided, rejected` | A decision's, in that order |
| `adrStatuses` | `proposed, decided` | An ADR's, in that order |

## How it works

```
<project>/Discovery/
  README.md                      what the folder is
  pending/<id>/walk.json         the walk as Claude published it, framed from the register
  pending/<id>/draft.json        your answers so far
  reviewed/<id>/                 the same, plus outcome.md and outcome.json
  notes/<initiative>.json        step notes, walked ticks, raised questions
  pending/<initiative>-checks/   what the last checks found, as finding cards
```

- **Reading.** On session start and on refresh, the desk finds every `prototype.js` under the prototype root. Opening an initiative reads its journey pages. Both are parsed as object literals: anything that is not plain data (a call, a variable, a `${…}` template) stops the read with the line it is on, and the desk shows that instead of the initiative.
- **Publishing.** Claude publishes with `publish_walk`. The desk checks each card against the register, fills in the item's status and the steps that show it, and writes the walk to `pending/<id>/`. Publishing the same id again keeps your answers for the cards that stayed.
- **The hub.** Opening an initiative also reads its hub page (`index.html`) for the core loop (the `.life` rows of `.st` states) and its README for the first `##` section about the story, the cast or the world. Both are optional; a view with nothing to show says so.
- **Checking.** **Run checks**, or the end of a turn that edited a prototype, runs the desk's checks and the validator (with `process.run`, from the project root) and writes what they find as the `<initiative>-checks` walk. Each finding keeps its id from run to run, so your answers survive a re-run. The desk records the last result per initiative for the status line.
- **Guarding.** A hook on every tool call notes when a record-writing tool runs, and refuses or annotates an edit to a prototype's register or pages when none has run in the turn yet. The count starts again when the main turn ends; a subagent's turn ending does not reset it.
- **Drawing.** The panel draws from those files, with the view in `$.state` so it survives the mod reloading. Play runs on a timer that a reload stops.
- **Submitting.** The outcome is written beside the walk, the folder moves to `reviewed/`, and the questions you raised are marked as handed over. The prompt handed back tells Claude to apply the answers in the record first and in a fixed order, then mirror them into the prototype. It also tells Claude never to change an initiative's score or verdict, and to confirm with you before writing.

## Known limits

- **No phone in the panel.** A pane cannot host a web page, so the panel shows each step's text, screen name, chips and callouts; **Open on** asks Claude to show the real page in the browser pane.
- **Plain-literal prototypes only.** A register or journey page that computes its values cannot be read; the desk says which line stopped it.
- **The guard knows the record by its tools.** It counts a record write by the tool's name (`vaultWriteTools`) or by an edit under `vaultRoot`; a record written some other way does not count. A change that only mirrors the record (fixing drift) still gets the reminder in `warn` mode, and is refused in `block` mode.
- **The validator's report is read by its lines.** Only lines that start `ERROR` or `warn` become findings, each read as `<where>: <message>`.
- **The hub's loop is read from its markup.** Only `.life` rows of `.st` spans (with `end`, `side` and `flag`) become the loop; a hub drawn another way shows none.
- **Proposed numbers.** A raised question's number comes from the register, which may lag the record. Claude is told to check the record's highest number before recording it.
- **An answer arrives when Claude has finished its turn.** A question sent from a card, a polish request or an **Open on** request waits its turn in the session.
- **Text you type is saved when you press Enter or move on.**
- **The function-hook plugin API is early access** and may change between Claude Code releases. Built and tested against Claude Code 2.1.317.

## Credits

The card frame, the per-card chat, the plan rows and the outcome hand-off are adapted from [review-desk](../review-desk) in this repository.

## Licence

MIT, see the repository's [LICENSE](../../LICENSE).
