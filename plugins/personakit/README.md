# Personakit

Synthetic-customer engine for GitHub Copilot — generate market-research-grounded
persona agents, interview them, run multi-persona panels, and let a Product
Manager Orchestrator agent turn the feedback into pricing and a complete
go-to-market plan.

> ⚠️ **Public Preview.** APIs, file formats, and the `.agent.md` schema may change.

## What it does

Personakit implements the *Synthetic Customers* + *Agents in Roles* pattern from
[*One Hundred POCs a Day*](https://agentdrivendevelopment.com/one-hundred-pocs-a-day/):

| Capability | What you ask | What happens |
| ---------- | ------------ | ------------ |
| Bootstrap | "Set up personakit for this project" | Initializes `.personakit/` with subdirs for personas, research, transcripts, GTM, and audit log. |
| Generate personas | "Generate 5 personas for a mid-market PM SaaS tool" | Runs market research (live web + your supplied docs), synthesizes 5 anonymized persona dossiers, and clones a custom Copilot agent for each one. |
| Interview a persona | "Ask Maya whether she'd use auto-Gantt" | Switches into Maya's custom agent for a sustained 1:1 conversation. |
| Panel discussion | "Run a panel on auto-Gantt with all 5 personas" | Round-robin multi-persona discussion; returns the transcript plus a structured summary of agreements, disagreements, and blockers. |
| PM review | "Have the PM orchestrator review auto-Gantt" | The `pm-orchestrator` agent invokes scoring + pricing tools, then runs `adversarial-pm` as a critic before presenting findings. |
| Go-to-market | "Produce a GTM plan for auto-Gantt" | Positioning, 3-tier pricing with attach rates, 4-week launch sequence, 3-scenario competitive response, and risk analysis — gated by mandatory adversarial review. |

## Skills

### `personakit-bootstrap`

Activated when the user wants to initialize Personakit in a workspace. Creates
the `.personakit/` sandbox and asks for a product brief if one isn't supplied.

### `personakit-generate-personas`

Activated when the user wants to create persona agents from a product brief
and/or research inputs. Calls `research_market` and/or `ingest_research`, then
`generate_personas`, and clones one custom Copilot agent per persona.

### `personakit-interview`

Activated when the user wants to talk 1:1 with a generated persona. Hands off
into the persona's custom agent so the conversation is real, not narrated.

### `personakit-panel`

Activated when the user wants multi-persona feedback on a topic or feature
brief. Runs `panel_discussion` and renders the transcript plus structured
summary.

### `personakit-pm-review`

Activated when the user wants the PM Orchestrator agent to evaluate a feature.
Runs `score_feature` across personas, drafts pricing, and **always** runs
`adversarial_review` before presenting.

### `personakit-go-to-market`

Activated when the user wants a complete GTM plan. Calls `produce_gtm` then
mandatorily `adversarial_review`. If every critic agrees, raises a
`FilterTooLooseWarning` instead of presenting the plan (per the blog's
"if every POC survives, your filter is broken" rule).

## Custom agents

| Agent | Role |
| ----- | ---- |
| `pm-orchestrator` | User-facing product manager. Drives end-to-end reviews. Has access to all `personakit-*` MCP tools and can invoke persona subagents. |
| `adversarial-pm` | Devil's advocate. Read-only + critique. Always argues against the feature. Required by the GTM gate. |
| `persona-template` | Template that the generator clones into `.personakit/agents/<persona-id>.agent.md` for each persona. The persona's dossier is embedded as the agent's system prompt. |

## MCP server

Personakit ships a TypeScript / Node MCP server (`personakit-mcp`) registered
via [`.mcp.json`](./.mcp.json). It owns the `.personakit/` filesystem sandbox,
the LLM client, and 10 tools.

### LLM credentials (auto-detected, in order)

1. `GITHUB_MODELS_TOKEN` — recommended for Copilot users
2. `OPENAI_API_KEY`
3. `ANTHROPIC_API_KEY`

If none are set, Personakit refuses to generate and tells the user how to
configure one.

### Prerequisites

- Node.js 18+
- An LLM credential (above)

## Safety guardrails

Per the [*Do This Safely*](https://agentdrivendevelopment.com/one-hundred-pocs-a-day/)
section of the blog:

- Sandboxed `.personakit/` filesystem (no writes outside the workspace root)
- PII anonymization on every ingested research document
- Demographic ranges in personas, never real individuals
- Mandatory adversarial review before any GTM is presented
- Append-only audit log of every MCP call

See [SECURITY.md](../../SECURITY.md) for the full threat model.

## Learn more

- Parent framework: [github/copilot-plugins](https://github.com/github/copilot-plugins)
- Methodology: [agentdrivendevelopment.com/one-hundred-pocs-a-day](https://agentdrivendevelopment.com/one-hundred-pocs-a-day/)
