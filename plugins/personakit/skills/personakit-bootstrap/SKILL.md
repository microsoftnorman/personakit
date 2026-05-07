---
name: personakit-bootstrap
description: Initialize Personakit in this workspace - create the .personakit/ sandbox and capture the product brief. USE THIS SKILL when the user asks to "set up personakit", "initialize personakit", "start personakit", or wants to begin a synthetic-customer workflow for the first time in a workspace.
allowed-tools: Read Write
---

# Personakit Bootstrap Skill

## Overview

This skill initializes Personakit in a workspace. It creates the
`.personakit/` sandbox and captures (or links to) a product brief that
subsequent skills will use to ground persona generation.

**Important**: Only run this skill when the user explicitly asks to set up,
initialize, or start Personakit. Do not bootstrap unprompted.

## When to use

| User says | Do this |
| --------- | ------- |
| "Set up personakit for this project" | Run bootstrap |
| "Initialize personakit using `examples/saas-project-management-tool`" | Run bootstrap, treat that folder's `product-brief.md` as the brief |
| "Start a synthetic-customer workflow for `<product>`" | Run bootstrap |
| "What is personakit?" | Do NOT bootstrap; explain instead |

## Common Scenarios

| User goal | How to respond | Tools needed |
| --------- | -------------- | ------------ |
| Bootstrap with an existing brief file | Read the brief, confirm with user, then call `generate_personas` later with that text | `Read`, then `personakit-generate-personas` skill |
| Bootstrap with no brief yet | Ask the user 3 questions: product name, target segment, the single biggest user problem it solves | (interactive) |
| Bootstrap into a folder that already has `.personakit/` | Note that the sandbox exists; ask whether to keep or replace existing personas | `Read` |

## Steps

1. Confirm the workspace root (use the Copilot workspace folder).
2. Tell the user what `.personakit/` will contain (personas, research,
   transcripts, gtm, audit) and that it is gitignored by default.
3. Locate or capture a product brief:
   - If the user pointed at a brief file (e.g. `examples/saas-project-management-tool/product-brief.md`), read it and summarize it back.
   - Otherwise, ask the 3 bootstrap questions and write the answers to
     `<workspace>/personakit-brief.md` (with the user's permission).
4. Confirm the GitHub Copilot credential. Personakit only works with GitHub
   Copilot — it uses GitHub-hosted models exclusively. It auto-detects in
   this order:
   - `GITHUB_MODELS_TOKEN` (preferred)
   - `GH_TOKEN` (set by the GitHub Copilot CLI for the active session)
   - `GITHUB_TOKEN` (generic GitHub token, also accepted)

   If none are present, instruct the user to set one before running
   `personakit-generate-personas`.
5. Suggest the next step: invoke the `personakit-generate-personas` skill.

The MCP server's `Store.init()` runs automatically on first tool call, so this
skill does not need to call any MCP tool — it is a *guided setup conversation*
that prepares context for the next skill.

## Example

```
User: Set up personakit for the SaaS project management tool example.

Agent: I'll initialize Personakit using the brief at
examples/saas-project-management-tool/product-brief.md.

  ✓ Workspace: d:/personakit
  ✓ Brief found: 2.1 KB, summary:
    A mid-market project management SaaS competing on integrations
    and AI-assisted planning.
  ✓ LLM credential detected: GITHUB_MODELS_TOKEN (GitHub Copilot)

  Next step — say:
    "Generate 5 personas for this brief using the research-inputs folder."
```

## Safety notes

- The `.personakit/` sandbox is workspace-local. Do not commit
  customer-derived personas to a public repo.
- The bootstrap skill never reads outside the workspace root.

## Learn more

- [Personakit README](../../README.md)
- [Parent framework: github/copilot-plugins](https://github.com/github/copilot-plugins)
