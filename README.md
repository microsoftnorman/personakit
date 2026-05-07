# Personakit

> Synthetic customers for GitHub Copilot. Generate market-research-grounded persona
> agents, interview them, run multi-persona panels, and let a Product Manager
> Orchestrator turn the feedback into pricing and a complete go-to-market plan.

Personakit is a [GitHub Copilot plugin](https://github.com/github/copilot-plugins)
that turns Copilot into a synthetic-customer engine. It implements the *Synthetic
Customers* + *Agents in Roles* pattern from
[*One Hundred POCs a Day*](https://agentdrivendevelopment.com/one-hundred-pocs-a-day/)
— minus the "build the code overnight" half (out of scope; that's a future
companion plugin).

## What's inside

- **6 skills** that auto-activate in any Copilot chat — bootstrap, generate
  personas, interview, panel discussion, PM review, go-to-market.
- **3 custom agents** — a `pm-orchestrator` that drives end-to-end product
  reviews, an `adversarial-pm` whose only job is to argue against the feature
  (per the blog's "if every POC survives, your filter is broken" rule), and a
  `persona-template` that the generator clones for each persona so you can chat
  with them 1:1.
- **`personakit-mcp`** — an MCP server (TypeScript / Node) that owns the
  filesystem-sandboxed persona store, market-research ingestion, panel
  orchestration, scoring, pricing synthesis, and GTM plan generation.

## How it works

```
┌────────────────────────────────────────────────────────────────┐
│ Copilot Chat                                                   │
│                                                                │
│  user ──► skill (auto-activates on prompt)                     │
│            │                                                   │
│            ├──► pm-orchestrator agent                          │
│            │       │                                           │
│            │       ├─ runSubagent(persona-maya)  ──┐           │
│            │       ├─ runSubagent(persona-devin) ──┤  panel    │
│            │       ├─ runSubagent(persona-priya) ──┤           │
│            │       ├─ runSubagent(adversarial-pm) ─┘           │
│            │       │                                           │
│            │       └─ MCP tools: research_market,              │
│            │           generate_personas, panel_discussion,    │
│            │           score_feature, produce_pricing,         │
│            │           produce_gtm, adversarial_review …       │
│            │                                                   │
│            └──► writes to .personakit/{personas,transcripts,   │
│                                       gtm,audit}/              │
└────────────────────────────────────────────────────────────────┘
```

## Quickstart

> Personakit is currently a public-preview spec + reference implementation.
> APIs, file formats, and the `.agent.md` schema may change.

1. Clone the repo and install:

   ```bash
   npm install
   npm run build -w personakit-mcp
   ```

2. Install the plugin into Copilot (mirrors the upstream plugin install flow —
   see [github/copilot-plugins](https://github.com/github/copilot-plugins)).

3. Provide an LLM credential. Personakit auto-detects in this order:

   - `GITHUB_MODELS_TOKEN` (recommended for Copilot users — no extra account)
   - `OPENAI_API_KEY`
   - `ANTHROPIC_API_KEY`

4. Try the reference example:

   ```
   You: Set up personakit using the example project at
        examples/saas-project-management-tool.
   You: Generate 5 personas from the research-inputs folder.
   You: Interview Maya about an auto-Gantt feature idea.
   You: Run a panel with all 5 personas on auto-Gantt.
   You: Have the PM orchestrator produce pricing and a GTM plan.
   ```

## Examples

These are realistic Copilot-Chat transcripts using the bundled
[Tessera](./examples/saas-project-management-tool/product-brief.md) reference
example (a fictional mid-market PM SaaS). The actual outputs you'll see depend
on the model, but the **shape** is contractual.

### Example 1 — Bootstrap and persona generation

```text
You: Set up personakit using examples/saas-project-management-tool.

Copilot (personakit-bootstrap skill):
  ✓ Workspace: d:/personakit
  ✓ Brief found: examples/saas-project-management-tool/product-brief.md
    Summary: Tessera — mid-market PM SaaS, wedge is "one status update
    propagates everywhere", competing with Asana/ClickUp/Linear/monday.
  ✓ LLM credential: GITHUB_MODELS_TOKEN

  Next step — say:
    "Generate 5 personas using the research-inputs folder."

────────────────────────────────────────────────────────────────────

You: Generate 5 personas using the research-inputs folder. Required
     archetypes: Mid-market Ops Director, Enterprise Senior Engineer,
     Startup CFO, Solo Consultant, VP Product (mid-market).

Copilot (personakit-generate-personas skill):
  ▸ ingest_research → 4 files anonymized and stored
      - analyst-snippet-mid-market-pm.md  (0 redactions)
      - g2-style-reviews.md                (0 redactions)
      - sales-call-signals.md              (0 redactions)
      - competitive-landscape.md           (0 redactions)
  ▸ generate_personas → 5 personas written:
      1. Maya   — Mid-market Ops Director  (mid-market SaaS, 100-300)
      2. Devin  — Enterprise Senior Engineer (enterprise tech, 1000+)
      3. Priya  — Startup CFO              (Series B-D, 50-150)
      4. Carlos — Solo Consultant          (freelance, 1)
      5. Aisha  — VP Product (mid-market)  (mid-market SaaS, 200-500)

  Each persona:
    - dossier:    .personakit/personas/<id>.md
    - structured: .personakit/personas/<id>.json
    - 1:1 agent:  .personakit/agents/persona-<id>.agent.md
```

### Example 2 — Single-persona interview (sustained conversation)

```text
You: Interview Maya about auto-Gantt generated from existing task data.

Copilot (personakit-interview skill → interview_persona):

  Maya (Mid-market Ops Director):
  > Honestly? Maybe. My team already lives in spreadsheets and we tried
  > four Gantt tools in the last two years. The reason none stuck was
  > onboarding — if I have to ask my PMs to learn another view, they'll
  > revolt. If your auto-Gantt populates from the data we already enter
  > and I can ship it without training, I'll pilot it. If it's a
  > separate module with its own data model, no.

  Session id: int-maya-20260507-141233-a8f2k1
  Transcript: .personakit/transcripts/int-maya-20260507-141233-a8f2k1.md

────────────────────────────────────────────────────────────────────

You: Follow up in session int-maya-20260507-141233-a8f2k1: what would
     change your mind on the "separate module" answer?

Copilot (personakit-interview skill — same session, prior turn replayed):

  Maya:
  > Two things. One: the Gantt view has to write back to my source of
  > truth. If I drag a bar in Gantt, the underlying ticket dates move.
  > Two: I need a one-click "turn it off for my team" toggle that
  > reverts cleanly. The last vendor we evaluated burned us because
  > disabling the Gantt module left orphan dependencies in our data.
```

### Example 3 — Multi-persona panel discussion

```text
You: Run a panel with all 5 personas on auto-Gantt.

Copilot (personakit-panel skill → panel_discussion, 3 rounds × 5 personas):

  ## Themes
  - Onboarding cost dominates adoption decisions across all 5 segments
  - Integration depth (write-back to source) is non-negotiable
  - AI features are tolerated when bundled, resented when up-charged

  ## Agreements
  - Auto-population from existing data is the only acceptable starting
    point — no separate data model
  - Disable/enable must be reversible without orphaned data

  ## Disagreements
  - Maya wants opt-in per team; Aisha wants default-on org-wide
  - Priya wants it included in Business tier; Carlos wants a freemium tier
  - Devin (enterprise) wants an audit trail of auto-generated changes;
    Carlos (solo) calls that "ridiculous overhead"

  ## Blockers
  - No clear migration path from existing standalone Gantt tools
  - Pricing posture conflicts directly with the Business-tier expectation
    surfaced by 3 of 5 personas

  Full transcript: .personakit/transcripts/panel-20260507-141512-3bk29x.md

  Suggested follow-up:
    "Have the PM orchestrator review auto-Gantt."
```

### Example 4 — PM Orchestrator review

```text
You: Have the PM orchestrator review auto-Gantt.

Copilot (handoff to pm-orchestrator agent):

  pm-orchestrator:
    ▸ score_feature across [maya, devin, priya, carlos, aisha]
        Maya:   7/10  willingness $10/seat  would recommend: yes
        Devin:  5/10  "another module to maintain"  would recommend: no
        Priya:  6/10  "include in base or no"  would recommend: maybe
        Carlos: 4/10  "won't use; not in my workflow"  would recommend: no
        Aisha:  8/10  "needs to be default-on"  would recommend: yes

    ▸ produce_pricing → 3 tiers drafted
        Recommendation: bundle into Business tier (moderate)

    ▸ adversarial_review (4 dimensions)
        market-fit:           CONCERN
          "Two of five personas score under 6 and one outright rejects."
        technical-feasibility: ACCEPT
          "Uses existing data model; write-back is well-scoped."
        strategic-alignment:   ACCEPT
          "Fits the 2026 integrations-first roadmap."
        customer-impact:       CONCERN
          "Carlos segment outright rejects; week-2 plan ignores
           onboarding cost surfaced in 3 of 5 personas."

  Verdict: PROCEED WITH CHANGES.
  Recommended next:
    1. Address the Carlos-segment objection OR explicitly de-scope that
       segment from launch.
    2. Tighten the week-2 beta cohort to mid-market only (Maya/Aisha
       look-alikes).
    3. Then say "produce a GTM plan for auto-Gantt".
```

### Example 5 — GTM plan with mandatory adversarial gate

```text
You: Produce a GTM plan for auto-Gantt.

Copilot (personakit-go-to-market skill):
  ▸ produce_gtm
    ✓ Plan drafted; gated until adversarial review runs.
  ▸ adversarial_review (4 dimensions)
    ✓ Status: passed-with-dissent — OK to present as DRAFT.

  ## Positioning
  Auto-Gantt closes the planning-tool gap mid-market PMs hit when
  spreadsheets become the source of truth and competing Gantt tools
  require re-entry. Timing: now, ahead of Asana's rumored Q3 release.

  ## Pricing (recommendation: bundle into Business tier)
  - conservative: $0, included in Business tier
  - moderate: $10/seat add-on; attach 30% mid-market / 5% startup
  - aggressive: $20/seat add-on; attach 12% mid-market / 0% startup

  ## Launch sequence
  - Week 1 (internal): sales talk track + CS troubleshooting guide
  - Week 2 (beta): 10 mid-market customers from CS retention list;
                   exit criteria: 4/10 enable in 14 days
  - Week 3 (controlled): 25% rollout, instrument auto-population success
                         rate; abort threshold: <60%
  - Week 4 (GA): launch blog + email sequence + landing page

  ## Competitive response
  - Ignored:     double down on integrations narrative
  - Copied:      lean on data-model depth and bug-bash track record
  - Leapfrogged: pivot to AI-assisted re-planning as the v2 wedge

  ## Risks
  - cannibalization: pulls users off the standalone Gantt module
    Mitigation: deprecate standalone after 6 months
  - infrastructure-cost: auto-population is read-heavy
    Mitigation: cap refresh frequency on conservative tier

  ## Adversarial verdicts
  - market-fit:     CONCERN — Carlos segment rejects (see PM review)
  - customer-impact: CONCERN — week-2 plan does not address onboarding cost

  Saved: .personakit/gtm/auto-gantt-gtm.md
  Reminder: this is a DRAFT. Bring it to a human PM with judgment.
```

### Example 6 — When the safety gate fires

This is what happens when every critic accepts the plan — Personakit refuses
to present it, per the blog's "if every POC survives, your filter is broken"
rule.

```text
You: Produce a GTM plan for the new "@-mention notifications" feature.

Copilot (personakit-go-to-market skill):
  ▸ produce_gtm
    ✓ Plan drafted; gated until adversarial review runs.
  ▸ adversarial_review (4 dimensions)
    market-fit:           ACCEPT
    technical-feasibility: ACCEPT
    strategic-alignment:   ACCEPT
    customer-impact:       ACCEPT

  ⚠️  FilterTooLooseWarning: every critic accepted the plan.
      Per Personakit safety policy, this plan WILL NOT be presented as-is.

  Recommended actions:
    1. Re-run with harder critics:
       "adversarial_review for at-mention-notifications, dimensions:
        market-fit-skeptic, security-auditor, churn-risk, support-load"
    2. Or revise the plan first — the unanimous accept usually means the
       plan is too vague to attack, not that the feature is uncontestable.
```

### Example 7 — Direct MCP usage (no Copilot host)

If you just want the tools — not the skills/agents — you can call the MCP
server directly with the [MCP Inspector](https://github.com/modelcontextprotocol/inspector):

```bash
# After: npm install && npm run build -w personakit-mcp
$env:GITHUB_MODELS_TOKEN = "<your token>"
$env:PERSONAKIT_WORKSPACE_ROOT = (Get-Location).Path
npx @modelcontextprotocol/inspector node packages/personakit-mcp/dist/index.js
```

The Inspector shows all 11 tools with their JSON schemas. Try them in this
order: `ingest_research` → `generate_personas` → `interview_persona` →
`panel_discussion` → `score_feature` → `produce_pricing` → `produce_gtm` →
`adversarial_review`.

### What gets written to `.personakit/`

After running the full sequence above, the sandbox looks like:

```text
.personakit/
├── personas/
│   ├── maya.md            ← narrative dossier (also the agent system prompt)
│   ├── maya.json          ← structured fields
│   ├── devin.md / .json
│   ├── priya.md / .json
│   ├── carlos.md / .json
│   └── aisha.md / .json
├── agents/                ← one custom Copilot agent per persona
│   ├── persona-maya.agent.md
│   └── …
├── research/
│   ├── tessera-mid-market-pm.json     ← structured MarketBrief
│   └── tessera/
│       ├── analyst-snippet-mid-market-pm.md  ← anonymized chunk
│       └── …
├── transcripts/
│   ├── int-maya-….md          ← interview transcripts
│   └── panel-….md / .json     ← panel transcripts + structured summary
├── feedback/
│   └── auto-gantt-scores.json
├── gtm/
│   ├── auto-gantt-pricing.json
│   ├── auto-gantt-gtm.json    ← machine-readable plan
│   └── auto-gantt-gtm.md      ← human-readable plan with verdicts
└── audit/
    └── 2026-05-07.jsonl       ← every MCP call, inputs/outputs scrubbed
```

## Safety guardrails (baked in, not optional)

Per [*One Hundred POCs a Day → Do This Safely*](https://agentdrivendevelopment.com/one-hundred-pocs-a-day/):

- **Sandboxed filesystem.** All persona/research/transcript/GTM artifacts live
  under `.personakit/` in your workspace. The MCP server refuses writes outside
  that root.
- **Anonymized synthetic personas only.** PII patterns in ingested research are
  redacted before storage. Generated personas use demographic *ranges*, never
  real individuals.
- **Adversarial review is mandatory** before any GTM plan is presented. If every
  critic agrees, Personakit raises a `FilterTooLooseWarning` instead of shipping
  the plan.
- **Full audit log.** Every MCP tool call appends to
  `.personakit/audit/YYYY-MM-DD.jsonl` with inputs, outputs, and rationale.
- **Drafts, not prophecy.** Pricing and GTM outputs are explicitly labeled as
  starting-point drafts. Humans dispose; agents propose.

## Layout

```
.
├── .github/plugin/marketplace.json     # plugin registry
├── plugins/personakit/
│   ├── README.md
│   ├── .mcp.json                       # registers personakit-mcp
│   ├── skills/                         # 6 SKILL.md files
│   └── agents/                         # 3 .agent.md files
├── packages/personakit-mcp/            # the MCP server
└── examples/saas-project-management-tool/
```

## License

[MIT](./LICENSE).
