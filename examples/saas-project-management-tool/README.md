# Reference example — Tessera (fictional mid-market PM SaaS)

This folder is the canonical Personakit example. It contains:

- `product-brief.md` — fictional product description used as the input to
  `personakit-bootstrap` and `personakit-generate-personas`.
- `research-inputs/` — four fabricated research files (analyst snippet,
  G2-style reviews, sales-call signals, competitive landscape) for
  `ingest_research`.

Everything in this folder is **synthetic**. No real company, customer, or
analyst report is described.

## Suggested prompt sequence

```text
Set up personakit using the example project at
examples/saas-project-management-tool.

Generate 5 personas using the research-inputs folder. Required archetypes:
  - Mid-market Ops Director
  - Enterprise Senior Engineer
  - Startup CFO
  - Solo Consultant
  - VP Product (mid-market)

Interview Maya about an "auto-Gantt generated from existing task data"
feature.

Run a panel with all 5 personas on auto-Gantt.

Have the PM orchestrator review auto-Gantt.

Produce a GTM plan for auto-Gantt.
```

After step 4 the PM orchestrator should call `score_feature`,
`produce_pricing`, and `adversarial_review`. After step 5 it should call
`produce_gtm` then mandatorily `adversarial_review` again. The final GTM
markdown lands at `.personakit/gtm/auto-gantt-gtm.md`.
