---
name: personakit-pm-review
description: Hand off to the PM Orchestrator agent to evaluate a feature end-to-end - score it across personas, draft pricing, and run adversarial review. USE THIS SKILL when the user asks the PM to "review", "evaluate", "rate", or "assess" a feature - "have the PM review auto-Gantt", "PM evaluation of <feature>", "score <feature> across personas and price it", "what does the PM orchestrator think of <feature>".
allowed-tools: Read
---

# Personakit PM Review Skill

## Overview

This skill hands the conversation to the `pm-orchestrator` custom agent. The
orchestrator runs:

1. `score_feature` against all (or a chosen subset of) personas
2. `produce_pricing` with the scores and (if available) the latest market brief
3. `adversarial_review` via the `adversarial-pm` subagent — **mandatory** before
   the orchestrator presents findings

If the adversarial reviewer accepts on every dimension, the orchestrator
surfaces a `FilterTooLooseWarning` instead of the verdict (per the blog's
"if every POC survives, your filter is broken" rule).

**Important**: The PM orchestrator never presents results without adversarial
review having run. If a critical dimension returns `kill`, the orchestrator
proposes revisions rather than shipping the verdict.

## When to use

| User says | Action |
| --------- | ------ |
| "Have the PM review auto-Gantt" | Hand off to `pm-orchestrator` |
| "What does my PM orchestrator think of the new pricing tier?" | Hand off |
| "Evaluate this feature across all personas and price it" | Hand off |
| "Run a quick interview with Maya" | Use `personakit-interview` instead |
| "Generate the GTM plan" | Use `personakit-go-to-market` instead |

## Common Scenarios

| User goal | How to respond | Agent invoked |
| --------- | -------------- | ------------- |
| Cross-persona scoring + pricing draft + critique | Standard PM review flow | `pm-orchestrator` (which calls `adversarial-pm`) |
| Quick scoring only | Pass `pricing: false` instruction; orchestrator skips pricing | `pm-orchestrator` |
| Critique an existing pricing draft | Skip directly to `adversarial_review` (orchestrator can do this) | `pm-orchestrator` + `adversarial-pm` |

## Steps

1. Capture the feature brief (id, name, problem, solution).
2. Confirm which personas to score across (default: all generated personas).
3. Hand off to `pm-orchestrator` with the brief and persona list.
4. The orchestrator drives the rest. You will see:
   - `score_feature` results per persona
   - `produce_pricing` 3-tier draft
   - `adversarial_review` verdict per dimension
5. Present the orchestrator's final summary — never present a draft that has
   not gone through adversarial review.

## Example

```
User: Have the PM orchestrator review auto-Gantt.

Agent: Handing off to pm-orchestrator…

  pm-orchestrator:
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

- The orchestrator MUST call `adversarial_review`. If you see a draft
  presented without verdicts, treat it as a bug and prompt explicitly:
  "run adversarial review first".
- All artifacts are sandboxed under `.personakit/`.

## Learn more

- [Personakit README](../../README.md)
- [Agents in Roles section in *One Hundred POCs a Day*](https://agentdrivendevelopment.com/one-hundred-pocs-a-day/)
