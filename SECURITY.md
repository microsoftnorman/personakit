# Security Policy

## Supported versions

Personakit is in public preview. Only `main` is supported.

## Reporting a vulnerability

Please **do not** open a public issue for security reports. Open a
[private security advisory](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)
on this repository, or email the maintainers.

## Threat model — what Personakit takes seriously

Personakit runs on developer machines, ingests potentially sensitive market
research, and orchestrates LLM calls. The MCP server is designed with the
following guardrails:

| Risk | Mitigation |
| ---- | ---------- |
| Path traversal via tool inputs | All filesystem writes go through `src/store/` which normalizes paths and rejects anything outside `<workspace>/.personakit/`. |
| PII leaking into persona dossiers | `src/safety/anonymize.ts` runs on every ingested document. Generated personas use demographic ranges, never real individual data. |
| Prompt injection via web research | Fetched content is treated as data, not instructions. The LLM client strips known instruction-style markers before composing prompts. |
| Untrusted LLM output executed as code | Personakit never executes generated content. GTM/pricing/persona outputs are markdown + JSON only. |
| Credentials in transcripts | LLM client redacts env-var-shaped tokens before writing to `.personakit/audit/`. |
| Adversarial-review bypass | `produce_gtm` will not return a "ready to present" plan unless `adversarial_review` has run with at least one critic dissent. |

## Out of scope

- Cloud deployment of the MCP server (Personakit is local-only by design).
- Sharing `.personakit/` directories across users (treat them as workspace-local
  state, do not commit production-customer-derived personas to a public repo).
