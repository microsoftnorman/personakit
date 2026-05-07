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
├── .claude-plugin/marketplace.json     # symlink (cross-tool compat)
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
