# Personakit Architecture

Reference for how Personakit is wired together. If you only want to *use* it,
start with the [README](./README.md) — this doc is for contributors,
integrators, and the curious.

---

## Table of contents

- [Design pillars](#design-pillars)
- [System diagram](#system-diagram)
- [Components](#components)
  - [Plugin manifest](#plugin-manifest)
  - [Skills](#skills)
  - [Agents](#agents)
  - [`personakit-mcp` server](#personakit-mcp-server)
- [Tool catalog](#tool-catalog)
- [The `.personakit/` sandbox](#the-personakit-sandbox)
- [Data flow: a complete review cycle](#data-flow-a-complete-review-cycle)
- [Safety guardrails](#safety-guardrails)
  - [Sandboxed filesystem](#sandboxed-filesystem)
  - [PII anonymization](#pii-anonymization)
  - [Mandatory adversarial review (the GTM gate)](#mandatory-adversarial-review-the-gtm-gate)
  - [Audit log](#audit-log)
- [LLM credential resolution](#llm-credential-resolution)
- [Repository layout](#repository-layout)
- [Worked examples](#worked-examples)
- [Extending Personakit](#extending-personakit)

---

## Design pillars

Personakit implements the *Synthetic Customers* + *Agents in Roles* pattern from
[*One Hundred POCs a Day*](https://agentdrivendevelopment.com/one-hundred-pocs-a-day/).
Four ideas drive every design choice:

1. **Synthetic > assumed.** Personas are generated from anonymized market
   research, not invented from a vibe. Each persona is a first-class agent you
   can interview repeatedly.
2. **Adversarial review is non-negotiable.** No GTM plan ever reaches a human
   without surviving multiple critic agents. If every critic agrees, the system
   refuses to ship the plan ("if every POC survives, your filter is broken").
3. **Drafts, not prophecy.** Pricing, GTM, and persona reactions are explicitly
   labeled as starting-point drafts. Humans dispose; agents propose.
4. **Sandbox by default.** All artifacts live under `.personakit/` in the
   workspace. The MCP server refuses writes outside that root. Every tool call
   is appended to a daily audit log.

---

## System diagram

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

Three layers:

- **Skills** (markdown, auto-activated by Copilot) — the entry points the user
  triggers with natural language.
- **Agents** (markdown system-prompts spawned via `runSubagent`) — the long-
  running roles: PM orchestrator, adversarial PM, and one cloned persona
  template per generated persona.
- **MCP server** (TypeScript / Node, stdio transport) — owns state, runs the
  LLM calls, enforces the sandbox + audit + adversarial gate.

---

## Components

### Plugin manifest

[`.github/plugin/marketplace.json`](./.github/plugin/marketplace.json) follows
the [github/copilot-plugins](https://github.com/github/copilot-plugins) schema
exactly so Personakit installs through the same flow as any first-party plugin.
It points at [`plugins/personakit/`](./plugins/personakit/), which contains:

- [`plugins/personakit/.mcp.json`](./plugins/personakit/.mcp.json) — registers
  the `personakit-mcp` server (stdio transport, command = `node`,
  args = `[…/dist/index.js]`).
- [`plugins/personakit/skills/`](./plugins/personakit/skills/) — six SKILL.md
  files.
- [`plugins/personakit/agents/`](./plugins/personakit/agents/) — three
  `.agent.md` files.

### Skills

Six skills, all auto-activating via Copilot's natural-language matcher. Each is
a SKILL.md with YAML frontmatter (`name`, `description`, `allowed-tools`).

| Skill | Triggered by | What it does |
| --- | --- | --- |
| `personakit-bootstrap` | "set up personakit", "install personakit in this project" | Detects a product brief, checks LLM credentials, prints the next step. |
| `personakit-generate-personas` | "generate personas", "create synthetic customers" | Calls `ingest_research` then `generate_personas`. Writes `.md` + `.json` + per-persona `.agent.md`. |
| `personakit-interview` | "interview <persona>", "ask <persona> about …" | Calls `interview_persona`, supports `session_id` for sustained multi-turn conversations. |
| `personakit-panel` | "run a panel", "panel discussion on …" | Calls `panel_discussion` (N rounds × M personas), returns themes / agreements / disagreements / blockers. |
| `personakit-pm-review` | "have the PM orchestrator review …" | Hands off to the `pm-orchestrator` agent. |
| `personakit-go-to-market` | "produce a GTM plan for …" | Calls `produce_gtm`, then enforces the adversarial-review gate before presenting anything. |

### Agents

Three `.agent.md` files in [`plugins/personakit/agents/`](./plugins/personakit/agents/):

- **`pm-orchestrator`** — long-running PM-in-residence. Drives end-to-end
  reviews: pulls personas, runs panels, scores the feature, drafts pricing,
  invokes the adversarial PM, and only *then* offers a verdict.
- **`adversarial-pm`** — exists only to argue against the feature. Returns one
  of `accept` / `concern` / `kill` per dimension (market-fit,
  technical-feasibility, strategic-alignment, customer-impact, plus any
  user-supplied dimensions).
- **`persona-template`** — the system prompt every generated persona is cloned
  from. The generator copies this template into
  `.personakit/agents/persona-<id>.agent.md` and substitutes the persona's
  dossier so users can `@persona-maya` directly.

### `personakit-mcp` server

TypeScript / Node ≥ 18, ESM, strict mode. Located in
[`packages/personakit-mcp/`](./packages/personakit-mcp/). Built with:

- `@modelcontextprotocol/sdk` ^1.0.0 over stdio
- `zod` + `zod-to-json-schema` for tool schemas
- `vitest` for tests (currently 22 / 22 passing)

Top-level modules:

| Module | Responsibility |
| --- | --- |
| `src/index.ts` | MCP server bootstrap, tool registration, request routing. |
| `src/store/index.ts` | All `.personakit/` filesystem I/O. `Store.resolve()` is the only path-resolver and refuses anything outside the workspace root (path-traversal guard). |
| `src/safety/anonymize.ts` | PII redaction (email, phone, SSN, credit card, IP, secret-like tokens, URLs with tokens, street addresses, names). |
| `src/audit.ts` | Append-only JSONL audit log under `.personakit/audit/YYYY-MM-DD.jsonl`. Scrubs secret-shaped fields before writing. |
| `src/llm/client.ts` | LLM dispatch. Auto-detects `GITHUB_MODELS_TOKEN` → `OPENAI_API_KEY` → `ANTHROPIC_API_KEY`. |
| `src/context.ts` | Per-request execution context (workspace root, store, llm, audit). |
| `src/types.ts` | Shared zod schemas for `Persona`, `MarketBrief`, `InterviewTurn`, etc. |
| `src/tools/*.ts` | One file per tool family — `research`, `personas`, `interview`, `panel`, `feedback`, `pricing`, `gtm`. |

---

## Tool catalog

Eleven tools exposed by `personakit-mcp`. Each has a zod input schema, a zod
output schema, and is documented in the corresponding `src/tools/*.ts` file.

| Tool | File | Purpose |
| --- | --- | --- |
| `ingest_research` | `tools/research.ts` | Anonymizes raw research files and stores them under `.personakit/research/`. Reports redaction counts. |
| `research_market` | `tools/research.ts` | Synthesizes a structured `MarketBrief` from the ingested files. |
| `generate_personas` | `tools/personas.ts` | Generates N personas given required archetypes. Writes `.md` + `.json` + per-persona `.agent.md`. |
| `list_personas` | `tools/personas.ts` | Read-only list of personas in the sandbox. |
| `interview_persona` | `tools/interview.ts` | Single-persona Q&A. Supports `session_id` for sustained multi-turn conversations. Writes a transcript. |
| `panel_discussion` | `tools/panel.ts` | N rounds × M personas. Returns themes / agreements / disagreements / blockers + structured summary. |
| `score_feature` | `tools/feedback.ts` | Per-persona 0–10 score, willingness-to-pay, would-recommend, with rationale. |
| `produce_pricing` | `tools/pricing.ts` | Three-tier pricing draft (conservative / moderate / aggressive) with attach-rate estimates. |
| `produce_gtm` | `tools/gtm.ts` | Drafts the GTM plan. Returns `adversarialReview.status = "not-run"` until `adversarial_review` runs against it. |
| `adversarial_review` | `tools/gtm.ts` | Multi-critic dissent enforcement. See [the GTM gate](#mandatory-adversarial-review-the-gtm-gate). |
| `list_artifacts` | `tools/research.ts` | Read-only listing of everything currently in `.personakit/`. |

---

## The `.personakit/` sandbox

Every artifact Personakit produces lives under `<workspace>/.personakit/`. The
MCP server refuses writes outside that root via `Store.resolve()`.

```text
.personakit/
├── personas/
│   ├── maya.md            ← narrative dossier (also the agent system prompt)
│   ├── maya.json          ← structured fields
│   └── …
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

The sandbox is workspace-relative, which means it follows your project around
and is naturally `.gitignore`-able if you don't want to commit synthetic
research output.

---

## Data flow: a complete review cycle

The bootstrap → generate → interview → panel → score → price → GTM → review
cycle in pseudo-sequence:

```
user ──► personakit-bootstrap skill
           └─► (read) examples/.../product-brief.md
           └─► verify LLM credential, print next step

user ──► personakit-generate-personas skill
           ├─► ingest_research      → .personakit/research/<src>/*.md (anonymized)
           └─► generate_personas    → .personakit/personas/<id>.md + .json
                                       .personakit/agents/persona-<id>.agent.md

user ──► personakit-interview skill ── interview_persona ──► transcript.md
           ↑ (optional: pass session_id to continue)

user ──► personakit-panel skill ── panel_discussion ──► panel-….md + .json

user ──► personakit-pm-review skill ─► pm-orchestrator agent
           ├─► score_feature           per-persona scores
           ├─► produce_pricing         three-tier draft
           └─► adversarial_review      4 critic dimensions

user ──► personakit-go-to-market skill
           ├─► produce_gtm             status = "not-run"
           └─► adversarial_review      enforces the gate (below)
                  ├ all-accept     → status = "filter-too-loose"  (REFUSE to present)
                  ├ any-kill       → status = "killed"            (REFUSE to present)
                  └ accept+concern → status = "passed-with-dissent" (OK as DRAFT)
```

Every box in that diagram is one MCP tool call, and every MCP tool call
appends one line to today's audit log.

---

## Safety guardrails

Per [*One Hundred POCs a Day → Do This Safely*](https://agentdrivendevelopment.com/one-hundred-pocs-a-day/).
These are not flags. They are baked into the implementation and there is no
"unsafe mode".

### Sandboxed filesystem

`Store.resolve(relativePath)` is the only function in the codebase that turns a
relative path into an absolute one. It:

1. Joins the relative path against `<workspace>/.personakit/`.
2. Calls `path.resolve` on the result.
3. Checks that the resolved path is still a prefix of the sandbox root.
4. Throws `SandboxEscape` if it isn't.

Path-traversal payloads (`../../etc/passwd`, absolute paths, symlinks) all hit
the prefix check and are rejected before any file handle is opened.

### PII anonymization

`src/safety/anonymize.ts` runs on every byte of research input *before* it
hits disk. Patterns redacted:

- email addresses → `<REDACTED:email>`
- phone numbers (E.164 + common US formats)
- US SSN
- credit-card-shaped digit runs (Luhn-checked)
- IPv4 + IPv6 addresses
- secret-like tokens (`sk_…`, `ghp_…`, `pat_…`, etc.)
- URLs with embedded tokens / API keys
- US street addresses
- person-name patterns (first + last, with conservative recall)

The redaction count is reported back to the user (`✓ ingested foo.md (3 redactions)`)
so they can spot-check.

Generated personas use demographic *ranges* (company size 100–300, role
seniority "director-level"), never real individuals.

### Mandatory adversarial review (the GTM gate)

This is the strictest gate in the system. Implementation lives in
`src/tools/gtm.ts`.

1. `produce_gtm` always returns
   `adversarialReview = { status: "not-run", verdicts: [] }`.
2. The `personakit-go-to-market` skill is **required** to call
   `adversarial_review` against the plan before presenting it.
3. `adversarial_review` runs at minimum 4 critic dimensions:
   `market-fit`, `technical-feasibility`, `strategic-alignment`,
   `customer-impact` (callers may add more).
4. Each critic returns one of `accept` / `concern` / `kill`.

The status calculation:

| Critic distribution | Status | Effect |
| --- | --- | --- |
| Any `kill` | `killed` | Skill refuses to present the plan. Reports which critics killed it. |
| All `accept` | `filter-too-loose` | Skill refuses to present. Raises `FilterTooLooseWarning` and tells the user to add harder critics. |
| At least one `concern`, no `kill` | `passed-with-dissent` | Plan is presented, **labeled DRAFT**, with all dissenting verdicts inlined. |

The "all-accept means broken filter" rule comes directly from the source
blog post and is the entire point of the gate. Being unable to present a plan
that everyone loves is a feature.

### Audit log

`src/audit.ts` appends a single JSONL record per MCP tool call to
`.personakit/audit/YYYY-MM-DD.jsonl`. Each record contains:

```jsonc
{
  "ts": "2026-05-07T14:12:33.421Z",
  "tool": "produce_gtm",
  "input": { /* scrubbed */ },
  "output": { /* scrubbed */ },
  "rationale": "…",
  "durationMs": 1842
}
```

Before writing, the audit module walks the input/output object graphs and
replaces any value whose **key** matches a secret pattern (`token`, `apiKey`,
`authorization`, `password`, `secret`, etc.) with `<REDACTED:secret>`. The
*shape* of the object is preserved so the log remains greppable.

---

## LLM credential resolution

Resolved in this order, first non-empty wins:

1. `GITHUB_MODELS_TOKEN` — recommended for Copilot users (no extra account).
2. `OPENAI_API_KEY`
3. `ANTHROPIC_API_KEY`

If none are set, persona-generating tools fail fast with an instructive error
naming all three variables. Read-only tools (`list_personas`, `list_artifacts`)
work without credentials.

---

## Repository layout

```
.
├── .github/plugin/marketplace.json     # plugin registry
├── plugins/personakit/
│   ├── README.md
│   ├── .mcp.json                       # registers personakit-mcp
│   ├── skills/                         # 6 SKILL.md files
│   └── agents/                         # 3 .agent.md files
├── packages/personakit-mcp/
│   ├── package.json
│   ├── tsconfig.json
│   ├── vitest.config.ts
│   ├── src/
│   │   ├── index.ts                    # MCP server entry
│   │   ├── audit.ts
│   │   ├── context.ts
│   │   ├── types.ts
│   │   ├── store/index.ts
│   │   ├── safety/anonymize.ts
│   │   ├── llm/client.ts
│   │   ├── util/zod-to-json-schema.ts
│   │   └── tools/                      # research, personas, interview,
│   │                                   # panel, feedback, pricing, gtm
│   └── tests/                          # 22 vitest specs, all passing
├── examples/saas-project-management-tool/
│   ├── README.md
│   ├── product-brief.md                # fictional Tessera product
│   └── research-inputs/                # 4 anonymized fixture files
└── scripts/
    ├── lib/{common.sh,common.ps1}      # shared dep-check libraries
    ├── install.{sh,ps1}                # one-line installer
    ├── update.{sh,ps1}                 # update mechanism
    └── doctor.{sh,ps1}                 # read-only health check
```

---

## Worked examples

Realistic Copilot-Chat transcripts using the bundled
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

---

## Extending Personakit

Adding a new tool:

1. Create `packages/personakit-mcp/src/tools/<name>.ts` exporting a
   `register<Name>Tools(server, ctx)` function.
2. Define input + output zod schemas in the same file (or
   [`src/types.ts`](./packages/personakit-mcp/src/types.ts) if shared).
3. Wire it into [`src/index.ts`](./packages/personakit-mcp/src/index.ts).
4. Add a vitest in `packages/personakit-mcp/tests/`.
5. If a skill should expose it, add it to the relevant SKILL.md's
   `allowed-tools` list and document the trigger in the description.

Adding a new skill:

1. Create `plugins/personakit/skills/<name>/SKILL.md` with YAML frontmatter
   (`name`, `description`, `allowed-tools`).
2. The `description` is what Copilot's auto-activation matches against — be
   explicit about the natural-language triggers.

Adding a new persistent agent (rarely needed — generated personas are usually
the right primitive):

1. Create `plugins/personakit/agents/<name>.agent.md` with the agent system
   prompt.
2. Reference it from the orchestrator or a skill via `runSubagent`.

---

## License

[MIT](./LICENSE).
