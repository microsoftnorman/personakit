---
name: personakit-panel
description: Run a multi-persona round-robin panel discussion on a topic or feature brief. Returns the full transcript plus a structured summary (themes, agreements, disagreements, blockers). USE THIS SKILL when the user wants reactions from MULTIPLE personas at once - "run a panel on X", "what would all my personas think about Y", "get group feedback on Z", "have the personas discuss <topic>", "user research session on <feature>".
allowed-tools: Read
---

# Personakit Panel Skill

## Overview

This skill calls `panel_discussion` to run a round-robin discussion across N
personas on a topic or feature brief. Each persona's turn is its own LLM call
with the persona's dossier as system prompt and the running transcript as
context — so personas react to each other, not just to the topic.

Output:
- A markdown transcript at `.personakit/transcripts/<sessionId>.md`
- A structured `PanelSummary` with themes, agreements, disagreements, blockers
- A JSON copy at `.personakit/transcripts/<sessionId>.json`

**Important**: A panel is a directional signal, not validated evidence. Per
the blog: synthetic customers catch ~80% of structural issues but miss the
irrational stuff. Treat the disagreements list as a prompt for real customer
follow-up.

## When to use

| User says | Action |
| --------- | ------ |
| "Run a panel on auto-Gantt with all 5 personas" | `panel_discussion` with all persona ids |
| "What would my personas say about a $50/seat tier?" | `panel_discussion` with `featureBrief: "Pricing change to $50/seat..."` |
| "Have Maya, Devin, and Priya argue about the migration tool" | `panel_discussion` with those 3 ids |
| "Just ask Maya" | Use `personakit-interview` instead |

## Common Scenarios

| User goal | How to respond | Tools needed |
| --------- | -------------- | ------------ |
| Quick reaction round | `rounds: 1` | MCP |
| Default multi-round discussion | `rounds: 3` (default) | MCP |
| Deep deliberation | `rounds: 5` (slower, costlier) | MCP |
| Targeted feature discussion | Pass `featureBrief` in addition to `topic` | MCP |

## Steps

1. Confirm the persona list. If the user said "all", call `list_personas`
   and confirm the count.
2. Confirm the topic. If the user is reacting to a specific feature, capture
   the feature brief separately and pass as `featureBrief`.
3. Default to `rounds: 3`. Warn if `rounds × personas > 20` that this will
   take some time and tokens.
4. Call `panel_discussion`.
5. Render the panel summary FIRST (themes / agreements / disagreements /
   blockers), then offer the full transcript path.
6. Recommend follow-up actions based on the disagreements list.

## Example

```
User: Run a panel on auto-Gantt with all 5 personas.

Agent: Calling panel_discussion across [maya, devin, priya, carlos, aisha],
3 rounds…

  ## Themes
  - Onboarding cost dominates adoption decisions
  - Integration with existing tools is non-negotiable
  - Pricing should not be an upsell

  ## Agreements
  - Auto-population from existing data is the only acceptable starting point

  ## Disagreements
  - Maya wants opt-in; Aisha wants default-on
  - Priya wants it included in base; Carlos wants a freemium tier

  ## Blockers
  - No clear migration path from current Gantt tools

  Full transcript:
    .personakit/transcripts/panel-20260507-141512-3bk29x.md

  Suggested follow-up:
    Ask the Persona Manager to evaluate this feature
    (skill: personakit-persona-review).
```

## Safety notes

- Panel outputs are sandboxed under `.personakit/transcripts/`.
- Disagreements are intentionally surfaced — do not paper over them when
  presenting to a human PM.

## Learn more

- [Personakit README](../../README.md)
- [Synthetic Customers section in *One Hundred POCs a Day*](https://agentdrivendevelopment.com/one-hundred-pocs-a-day/)
