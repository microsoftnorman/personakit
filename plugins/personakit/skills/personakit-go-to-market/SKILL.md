---
name: personakit-go-to-market
description: Produce a complete go-to-market plan for a feature - positioning, 3-tier pricing, 4-week launch sequence, 3-scenario competitive response, risk analysis - GATED by mandatory adversarial review. USE THIS SKILL when the user asks for a "GTM plan", "go-to-market", "launch plan", "marketing plan", or "release strategy" for a feature. Trigger phrases include "produce a GTM for", "draft a launch plan", "go-to-market for <feature>", "generate the marketing plan".
allowed-tools: Read
---

# Personakit Go-to-Market Skill

## Overview

This skill calls `produce_gtm` then **mandatorily** `adversarial_review`
before presenting the plan. Per Personakit safety policy:

- A plan whose `adversarialReview.status === "not-run"` MUST NOT be presented.
- A plan whose status is `"filter-too-loose"` (every critic accepted) MUST NOT
  be presented as-is — re-run with harder critics or revise the plan.
- A plan whose status is `"killed"` MUST surface the killing concern; do not
  bury it.
- Only `"passed-with-dissent"` is OK to present, and even then it is a DRAFT.

This is the synthetic-customer half of the
[*One Hundred POCs a Day*](https://agentdrivendevelopment.com/one-hundred-pocs-a-day/)
GTM workflow — Personakit does NOT build the underlying code or deploy POCs;
that is out of scope for this plugin.

## When to use

| User says | Action |
| --------- | ------ |
| "Produce a GTM plan for auto-Gantt" | Run this skill |
| "What's our launch sequence for the new pricing tier?" | Run this skill |
| "Just score it across personas" | Use `personakit-persona-review` instead |
| "Don't bother with critique, just give me a plan" | Refuse — adversarial review is non-negotiable |

## Common Scenarios

| User goal | How to respond | Tools needed |
| --------- | -------------- | ------------ |
| Full GTM with all defaults | `produce_gtm` then `adversarial_review` | MCP |
| GTM with custom critique dimensions | Pass `dimensions` to `adversarial_review` | MCP |
| Re-critique an existing GTM | Skip `produce_gtm`; call `adversarial_review` only | MCP |

## Steps

1. Confirm the feature brief and pricing draft. If pricing has not been
   produced, run `personakit-persona-review` first or call `produce_pricing`
   directly.
2. Call `produce_gtm` with the feature, pricing, and persona scores.
3. **Always** call `adversarial_review` on the saved plan immediately after.
4. Inspect `plan.adversarialReview.status`:
   - `"passed-with-dissent"` → present the plan, label as DRAFT.
   - `"filter-too-loose"` → tell the user the plan was refused; ask whether to
     re-run with harder critics or revise.
   - `"killed"` → surface the killing concern; ask whether to revise.
5. Render: positioning → pricing → launch sequence → competitive response →
   risks → adversarial verdicts.
6. Note that the plan is a STARTING POINT, not a contract.

## Example

```
User: Produce a GTM plan for auto-Gantt.

Agent: Calling produce_gtm…
  ✓ Plan drafted; gated until adversarial review runs.

Agent: Calling adversarial_review (4 dimensions)…
  - market-fit: CONCERN — "Carlos segment rejects; rerun with revised target"
  - technical-feasibility: ACCEPT
  - strategic-alignment: ACCEPT
  - customer-impact: CONCERN — "onboarding cost not addressed in week-2 plan"

  Status: passed-with-dissent — OK to present as DRAFT.

  ## Positioning
  Auto-Gantt closes the planning-tool gap that mid-market PMs hit when
  spreadsheets become the source of truth and competing Gantt tools require
  re-entry. Timing: now, ahead of Asana's rumored Q3 release.

  ## Pricing (recommendation: bundle into Business tier)
  - conservative: $0, included in Business tier
  - moderate: $10/seat add-on, attach 30% mid-market / 5% startup
  - aggressive: $20/seat add-on, attach 12% mid-market / 0% startup

  ## Launch sequence
  - Week 1 (internal): sales talk track + CS troubleshooting guide
  - Week 2 (beta): 10 mid-market customers from Forward CS list, exit
    criteria: 4/10 enable in 14 days
  - Week 3 (controlled): 25% rollout, instrument auto-population success
    rate; threshold to abort: <60%
  - Week 4 (GA): launch blog + email sequence + landing page

  ## Competitive response
  - Ignored: double down on integrations narrative
  - Copied: lean on data-model depth and prior bug-bash track record
  - Leapfrogged: pivot to AI-assisted re-planning as the v2 wedge

  ## Risks
  - cannibalization — pulls users off the standalone Gantt module; mitigation:
    deprecate standalone after 6 months
  - infrastructure-cost — auto-population is read-heavy; mitigation: cap
    refresh frequency on conservative tier

  ## Adversarial verdicts
  - market-fit: CONCERN — Carlos segment rejects (see PM review)
  - customer-impact: CONCERN — week-2 plan does not address onboarding cost

  Saved: .personakit/gtm/auto-gantt-gtm.md
  Reminder: this is a DRAFT. Bring it to a human PM with judgment.
```

## Safety notes

- This skill REFUSES to present a plan that has not passed adversarial review.
  If you find yourself wanting to skip it, that is exactly when the rule
  matters most.
- All GTM artifacts are sandboxed under `.personakit/gtm/`.
- The pricing tiers, attach rates, and revenue projections are MODEL OUTPUTS,
  not forecasts. Validate against real sales data before committing.

## Learn more

- [Personakit README](../../README.md)
- [*Every POC Got a Go-to-Market Plan* in *One Hundred POCs a Day*](https://agentdrivendevelopment.com/one-hundred-pocs-a-day/)
- [SECURITY.md](../../../../SECURITY.md)
