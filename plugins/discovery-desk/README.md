# discovery-desk

A desk inside Claude Code for polishing low-fidelity UX prototype journeys. You open a journey in the panel (`/discovery`), step through it on iOS or Android, and answer its open questions, proposed decisions and ADRs on cards Claude puts up. When you submit, Claude gets the answers back with the order to apply them: the record (an Obsidian vault, a catalogue, ADR notes) first, then the prototype that mirrors it.

It reads prototypes built the way a *register plus journey pages* kit builds them: a `prototype.js` that sets `window.PROTOTYPE = {…}` (initiative, personas, surfaces, journeys, and the questions it mirrors), and one HTML page per journey that calls `Kit.journey({…})`. It reads both as data and never runs them or writes to them.

## What it does

- **A desk of walks and initiatives.** The home lists the walks waiting for you and the ones you submitted, then every initiative with a prototype, with its counts of open questions, proposals and decisions. The status line shows the walks waiting and the open initiative's counts.
- **A journey player.** You step through a journey with the context the kit shows beside the phone: persona, use case, trigger, preconditions, outcome, what differs between iOS and Android, story-map steps and surfaces. Each step shows its title, the screen it is on, its caption, its chips and its callouts.
- **Cards for each open question, proposed decision and ADR**, published by Claude and framed by the desk from the register. Each card shows the item's status, the journey steps that show it, what differs on each phone, the evidence and the linked risks, assumptions and experiments.
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
| `publish_walk` (tool for Claude) | Puts a walk on the desk: question, decision, ADR and plan cards for one initiative. The desk refuses a walk with a list of what to fix, for example a journey not in the register, or a question card whose id reads as a decision |
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
```

- **Reading.** On session start and on refresh, the desk finds every `prototype.js` under the prototype root. Opening an initiative reads its journey pages. Both are parsed as object literals: anything that is not plain data (a call, a variable, a `${…}` template) stops the read with the line it is on, and the desk shows that instead of the initiative.
- **Publishing.** Claude publishes with `publish_walk`. The desk checks each card against the register, fills in the item's status and the steps that show it, and writes the walk to `pending/<id>/`. Publishing the same id again keeps your answers for the cards that stayed.
- **Drawing.** The panel draws from those files, with the view in `$.state` so it survives the mod reloading. Play runs on a timer that a reload stops.
- **Submitting.** The outcome is written beside the walk, the folder moves to `reviewed/`, and the questions you raised are marked as handed over. The prompt handed back tells Claude to apply the answers in the record first and in a fixed order, then mirror them into the prototype. It also tells Claude never to change an initiative's score or verdict, and to confirm with you before writing.

## Known limits

- **No phone in the panel.** A pane cannot host a web page, so the panel shows each step's text, screen name, chips and callouts; **Open on** asks Claude to show the real page in the browser pane.
- **Plain-literal prototypes only.** A register or journey page that computes its values cannot be read; the desk says which line stopped it.
- **Proposed numbers.** A raised question's number comes from the register, which may lag the record. Claude is told to check the record's highest number before recording it.
- **An answer arrives when Claude has finished its turn.** A question sent from a card, a polish request or an **Open on** request waits its turn in the session.
- **Text you type is saved when you press Enter or move on.**
- **The function-hook plugin API is early access** and may change between Claude Code releases. Built and tested against Claude Code 2.1.317.

## Credits

The card frame, the per-card chat, the plan rows and the outcome hand-off are adapted from [review-desk](../review-desk) in this repository.

## Licence

MIT, see the repository's [LICENSE](../../LICENSE).
