---
name: personakit-persona-review
description: Hand off to the Persona Manager agent to evaluate a feature end-to-end - score it across the persona roster, draft pricing, and run adversarial review. USE THIS SKILL when the user asks the Persona Manager to "review", "evaluate", "rate", or "assess" a feature - "have the persona manager review auto-Gantt", "review <feature> across personas", "score <feature> across personas and price it", "what does the persona manager think of <feature>". Do NOT use when the user wants to add, remove, or rename personas - those are direct generate_personas / update_persona / delete_persona calls.
allowed-tools: Read
---

# Personakit Persona Review Skill

## Overview

This skill hands the conversation to the `persona-manager` custom agent. The
Persona Manager runs:

1. `score_feature` against all (or a chosen subset of) personas
2. `produce_pricing` with the scores and (if available) the latest market brief
3. `adversarial_review` via the `adversarial-critic` subagent — **mandatory**
   before the Persona Manager presents findings

If the adversarial reviewer accepts on every dimension, the Persona Manager
surfaces a `FilterTooLooseWarning` instead of the verdict (per the blog's
"if every POC survives, your filter is broken" rule).

> **Why "Persona Manager", not "PM"?** The agent does the work a product
> manager would do, but it's renamed so it can never be confused with
> *your* product manager. Its actual job is managing the persona roster
> (create / list / update / delete) and running synthetic-customer reviews
> on top of it.

**Important**: The Persona Manager never presents results without
adversarial review having run. If a critical dimension returns `kill`, the
agent proposes revisions rather than shipping the verdict.

## When to use

| User says | Action |
| --------- | ------ |
| "Have the Persona Manager review auto-Gantt" | Hand off to `persona-manager` |
| "Review the new pricing tier across personas" | Hand off |
| "Evaluate this feature across all personas and price it" | Hand off |
| "Run a quick interview with Maya" | Use `personakit-interview` instead |
| "Generate the GTM plan" | Use `personakit-go-to-market` instead |
| "Add / delete / rename a persona" | Hand off, but the agent will use `generate_personas` / `update_persona` / `delete_persona` directly — not a review |

## Common Scenarios

| User goal | How to respond | Agent invoked |
| --------- | -------------- | ------------- |
| Cross-persona scoring + pricing draft + critique | Standard review flow | `persona-manager` (which calls `adversarial-critic`) |
| Quick scoring only | Pass `pricing: false` instruction; the agent skips pricing | `persona-manager` |
| Critique an existing pricing draft | Skip directly to `adversarial_review` | `persona-manager` + `adversarial-critic` |

## Steps

1. Capture the feature brief (id, name, problem, solution).
2. Confirm which personas to score across (default: all generated personas).
3. Hand off to `persona-manager` with the brief and persona list.
4. The agent drives the rest. You will see:
   - `score_feature` results per persona
   - `produce_pricing` 3-tier draft
   - `adversarial_review` verdict per dimension
5. Present the agent's final summary — never present a draft that has not
   gone through adversarial review.

## Example

```
User: Have the Persona Manager review auto-Gantt.

Agent: Handing off to persona-manager…

  persona-manager:
    ▸ score_feature across [maya, devin, priya, carlos, aisha]
      - Maya: 7/10, would pilot
      - Devin: 5/10, "another module to maintain"
      - Priya: 6/10, "include in base or no"
      - Carlos: 4/10, "won't use"
      - Aisha: 8/10, "needs to be default-on"

    ▸ produce_pricing → 3 tiers drafted, recommendation: bundle into Business

    ▸ adversarial_review (4 dimensions)
      - market-fit: CONCERN — "two of five personas score under 6"
      - technical-feasibility: ACCEPT — "uses existing data model"
      - strategic-alignment: ACCEPT — "fits 2026 integrations roadmap"
      - customer-impact: CONCERN — "Carlos segment outright rejects"

  Verdict: PROCEED WITH CHANGES.
  Recommended next: address Carlos-segment objection before GTM,
  then say "produce a GTM plan for auto-Gantt".
```

## Safety notes

- The Persona Manager MUST call `adversarial_review`. If you see a draft
  presented without verdicts, treat it as a bug and prompt explicitly:
  "run adversarial review first".
- All artifacts are sandboxed under `.personakit/`.

## Learn more

- [Personakit README](../../README.md)
- [Agents in Roles section in *One Hundred POCs a Day*](https://agentdrivendevelopment.com/one-hundred-pocs-a-day/)
