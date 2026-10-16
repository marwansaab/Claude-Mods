# review-desk

A review desk inside Claude Code. When Claude needs you to answer questions, approve decisions, accept or reject findings, approve a write plan, walk through an explainer or read a long text, it puts the work on the desk. You open the panel (`/reviews`), work through the cards, ask questions as you go and submit. Claude gets the outcome back and applies it.

There are no HTML pages to build, no browser to open and no notes to export and paste back. It is made for projects that pair a Claude project folder with a record of truth, such as an Obsidian vault, but it works in any project.

## What it does

- **A list of reviews.** Pending reviews show how many cards you have answered; submitted ones stay under *Reviewed* and open read-only with your responses. The status line shows how many reviews are waiting.
- **Six kinds of card**, all in one review if needed:

  | Card | You |
  | --- | --- |
  | **Question** | pick an option (Claude's recommended one is marked) or write an answer |
  | **Decision** | approve, approve with changes, or reject, with a comment |
  | **Finding** | accept, reject or discuss, with a reply; quotes, severity and "the record says" evidence are shown |
  | **Plan** | untick rows you do not want, then go ahead or cancel |
  | **Explainer** | step through animated scenes with captions and graded claims, ticking *Got it* |
  | **Read-through** | read a long text section by section, with "Your call" flags, a note and a *Reviewed* tick each |

- **Animated explainers.** Claude sends the scene as data and the desk draws it, on the desktop, as animated SVG: cards, flow, list, timeline, funnel, bars with a threshold, number tiles, a comparison table and a 2 × 2 matrix. Claim chips carry their grade (A–D), and hovering one shows the claim. In the terminal the same scene is drawn as text.
- **Ask as you go.** Every card has an *Ask* box. A **quick answer** is written in the panel from the review's own content. **Ask Claude in the session** sends the question to the conversation, where Claude can read your project.
- **Saved as you go.** Every answer is written to `draft.json` straight away. Close the panel, or end the session, and carry on later.
- **Submit, and Claude applies it.** Submitting writes `outcome.md` and `outcome.json`, moves the review to `reviewed/`, and queues a prompt that asks Claude to apply the outcome in each record's real home and to confirm with you before writing.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install review-desk --marketplace marwansaab/Claude-Mods
```

Answer `y` to add the marketplace, then choose a scope. A mod installed this way also loads in the desktop app's Code tab.

## Commands and tools

| Name | What it does |
| --- | --- |
| `/reviews` | Opens the review desk, or closes it when it is open |
| `publish_review` (tool for Claude) | Puts a review on the desk. Claude is told to use it instead of building HTML review pages or asking many questions in chat |
| `list_reviews` (tool for Claude) | Lists pending and submitted reviews, with the path of each outcome |

To start, ask Claude something like *"put the open questions for this initiative up for review"*, *"send this write plan to the review desk"* or *"make an explainer of this note on the review desk"*.

## Settings

| Setting | Default | What it does |
| --- | --- | --- |
| Reviews folder | `Reviews` | The folder in the project, relative to its root, that holds `pending/` and `reviewed/` |
| Open the desk when Claude publishes a review | on | Opens the panel on the new review, unless you are in the middle of another one |
| Hand submitted reviews to Claude | on | On submit, queues a prompt asking Claude to apply the outcome |
| Model for quick answers | empty (the session's model) | A model alias or id for the panel's quick answers, for example `haiku` |

## How it works

```
<project>/Reviews/
  README.md                      what the folder is
  pending/<id>/pack.json         the review as Claude published it
  pending/<id>/draft.json        your answers so far
  reviewed/<id>/                 the same, plus outcome.md and outcome.json
```

- **Claude publishes** with `publish_review`. The desk checks the pack and refuses it with a list of what to fix when something is missing. For example, it refuses a card without its text, or a claim that is cited but not listed. Publishing the same id again replaces the pack and keeps your answers for the cards whose ids stayed the same.
- **The panel draws from those files**, with the view state in `$.state` so it survives the mod reloading.
- **On submit**, the outcome is written beside the pack, and the folder is moved to `reviewed/<id>/` (or `<id>--2` when that id was reviewed before). If the move fails, for example because a file is open in another program, the files are copied instead and the pending copy is hidden.
- **The files mirror the record and are never the record.** The prompt handed back to Claude tells it to apply each response in the source note or file, following the project's own rules, and to confirm before writing.

### The pack format

`publish_review` takes `title`, `cards` and optionally `id`, `label`, `summary`, `origin`, `sources` (the notes it mirrors, with their `updated` dates) and `claims` (`id`, `text`, `grade` A–D, `source`, `url`, `checked`). The full schema is in [`hooks/pack.ts`](hooks/pack.ts) (`PUBLISH_SCHEMA`), and the types are in [`types/index.d.ts`](types/index.d.ts).

```json
{
  "id": "INIT-002-open-questions",
  "title": "Open questions for the blackjack prototype",
  "label": "Open questions",
  "cards": [
    {
      "type": "question", "id": "Q-13", "title": "Report an inappropriate ad",
      "prompt": "Should players be able to report an ad from the ad itself?",
      "options": [{ "id": "yes", "label": "Yes" }, { "id": "later", "label": "Not in the first release" }],
      "recommended": "yes"
    },
    {
      "type": "explainer", "id": "retention", "title": "Why players leave",
      "steps": [{
        "title": "The drop", "caption": "Most players leave in the first week.",
        "scene": { "kind": "bars", "items": [{ "label": "Day 1", "value": 40, "display": "40%", "claim": "C1" }], "mark": { "value": 20, "label": "target" } }
      }]
    }
  ],
  "claims": [{ "id": "C1", "text": "Day-1 retention is about 40%.", "grade": "B", "source": "Analytics firm report", "url": "https://…" }]
}
```

## Known limits

- **Desktop and terminal.** Animated scenes draw on the desktop. The terminal shows them as text, and the mobile app, which has no text fields yet, shows reviews without the answer boxes.
- **Quick answers know only the review.** They cannot read your project or vault; use *Ask Claude in the session* for that.
- **Text you type is saved when you press Enter or move on.** Typing and then closing the window straight away can lose the last field.
- **Reviewed items are read-only.** To review something again, ask Claude to publish it again; the new review is filed separately.
- **The function-hook plugin API is early access** and may change between Claude Code releases. Built and tested against Claude Code 2.1.296.
