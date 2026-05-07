---
name: personakit-generate-personas
description: Generate synthetic customer personas grounded in market research. Each persona is written as a dossier AND a custom Copilot agent the user can chat with 1:1. USE THIS SKILL when the user asks to "generate personas", "create customer archetypes", "make synthetic customers", "build personas from research", or asks for the personas for a product. Trigger phrases include "generate N personas", "create personas for", "build me synthetic users", "model my customers".
allowed-tools: Read Write
---

# Personakit Generate Personas Skill

## Overview

This skill produces synthetic customer personas using two MCP tools:
- `research_market` — optional public-web research grounded in URLs the user
  provides
- `ingest_research` — for user-supplied research files in the workspace
- `generate_personas` — synthesizes the dossiers and writes both `.md`
  (narrative) and `.json` (structured) plus one custom `.agent.md` per persona

**Important**: Generated personas are SYNTHETIC ARCHETYPES. They use
demographic ranges only and never represent real individuals. Per Personakit
safety policy, ingested research is anonymized before storage.

## When to use

| User says | Action |
| --------- | ------ |
| "Generate 5 personas for the auto-Gantt SaaS" | `generate_personas` |
| "Use the research in `examples/.../research-inputs/` to make personas" | `ingest_research` then `generate_personas` |
| "Create a persona for an enterprise CFO" | `generate_personas` with `archetypes: ["Enterprise CFO"]` |
| "Add some web research first" | `research_market` then `generate_personas` |

## Common Scenarios

| User goal | How to respond | Tools needed |
| --------- | -------------- | ------------ |
| Personas from product brief only | Call `generate_personas` with `productBrief` only | MCP |
| Personas from local research files | Call `ingest_research` then `generate_personas` with `researchFiles` | MCP |
| Personas from web sources | Call `research_market` with `urls`, then `generate_personas` with `marketBriefFiles` | MCP |
| Both web + local | Run both ingestion paths first, pass both to `generate_personas` | MCP |

## Steps

1. Establish the product brief (from the bootstrap skill or by asking).
2. Ask the user how many personas (default: 5) and whether they have specific
   archetypes in mind.
3. If the user supplied research files or URLs:
   - For local files: call `ingest_research` with `paths` and a `topic`.
   - For URLs: call `research_market` with `domain`, `segment`, `urls`.
4. Call `generate_personas` with the brief, count, archetypes (if any), and
   the research file references from steps above.
5. Show the user the persona list (display name + archetype + segment) and
   tell them they can now invoke the `personakit-interview` or
   `personakit-panel` skills, or chat 1:1 with any persona's custom agent.

## Example

```
User: Generate 5 personas for the SaaS PM tool using the research-inputs folder.

Agent: I'll ingest the research first, then generate 5 personas.

  ▸ ingest_research → 4 files anonymized and stored
  ▸ generate_personas → 5 personas written:
    1. Maya — Mid-market Ops Director (mid-market SaaS)
    2. Devin — Enterprise Senior Engineer (enterprise tech)
    3. Priya — Startup CFO (Series B-D)
    4. Carlos — Solo Consultant (freelance)
    5. Aisha — VP Product (mid-market, integrations-first)

  Each one has a dossier at .personakit/personas/<id>.md
  and a custom agent at .personakit/agents/persona-<id>.agent.md.

  Next step — say "Interview Maya about <feature>" to talk to her 1:1,
  or "Run a panel with all 5 personas on <topic>".
```

## Safety notes

- The `generate_personas` tool defence-in-depth-redacts any persona dossier
  text that still contains PII shapes after generation.
- All persona demographics are RANGES (e.g. "38-46"), never point values.
- The `generatedFromResearch` field on each persona records which research
  refs were used so a human can trace the provenance.

## Learn more

- [Personakit README](../../README.md)
- [Synthetic Customers section in *One Hundred POCs a Day*](https://agentdrivendevelopment.com/one-hundred-pocs-a-day/)
