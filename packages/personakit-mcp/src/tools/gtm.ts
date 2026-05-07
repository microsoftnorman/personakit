/**
 * Tools: produce_gtm, adversarial_review.
 *
 * GTM gate enforcement (per the blog's "Adversarial review is not optional"):
 * - produce_gtm always returns adversarialReview.status = "not-run".
 * - The personakit-go-to-market skill MUST call adversarial_review before
 *   presenting the plan.
 * - If adversarial_review finds NO dissent across critics, the plan is marked
 *   "filter-too-loose" — the skill refuses to ship it as-is.
 */
import { z } from "zod";
import type { ToolContext } from "../context.js";
import { extractJson, slug } from "../context.js";
import {
  type GtmPlan,
  GtmPlanSchema,
  FeatureBriefSchema,
  PricingPlanSchema,
  PersonaScoreSchema,
} from "../types.js";

// ─────────────────────────────────────────────────────────────────────────────
// produce_gtm
// ─────────────────────────────────────────────────────────────────────────────

export const ProduceGtmInput = z.object({
  feature: FeatureBriefSchema,
  pricing: PricingPlanSchema,
  scores: z.array(PersonaScoreSchema).min(1),
  competitors: z
    .array(z.object({ name: z.string(), positioning: z.string().optional() }))
    .optional(),
});
export type ProduceGtmInput = z.infer<typeof ProduceGtmInput>;

export interface ProduceGtmOutput {
  plan: GtmPlan;
  storedAt: string;
  /** Always present; reminds caller they MUST run adversarial_review next. */
  warning: string;
}

const GTM_GATE_WARNING =
  "GTM plan generated with adversarialReview.status = 'not-run'. The personakit-go-to-market skill MUST call adversarial_review before presenting this plan to the user. If every critic agrees, the plan will be marked 'filter-too-loose' and refused.";

export async function produceGtm(
  ctx: ToolContext,
  input: ProduceGtmInput,
): Promise<ProduceGtmOutput> {
  const raw = await ctx.llm.complete({
    purpose: "produce_gtm",
    temperature: 0.55,
    maxTokens: 2_500,
    messages: [
      {
        role: "system",
        content: [
          "You are a head-of-product drafting a GO-TO-MARKET plan as a STARTING POINT.",
          "Be specific about timing, audiences, and exit criteria. Be honest about risk.",
          "Output strictly valid JSON. Do not invent specific competitor financials.",
          "Treat all outputs as drafts a human will refine.",
        ].join("\n"),
      },
      {
        role: "user",
        content: buildGtmPrompt(input),
      },
    ],
  });
  const parsed = extractJson<unknown>(raw);
  const plan = GtmPlanSchema.parse({
    ...(parsed as object),
    featureId: input.feature.id,
    generatedAt: new Date().toISOString(),
    pricing: input.pricing,
    adversarialReview: { status: "not-run" },
  });

  const storedAt = await ctx.store.writeJson(
    "gtm",
    `${slug(input.feature.id)}-gtm.json`,
    plan,
  );
  await ctx.store.writeText(
    "gtm",
    `${slug(input.feature.id)}-gtm.md`,
    renderGtmMarkdown(plan),
  );

  return { plan, storedAt, warning: GTM_GATE_WARNING };
}

function buildGtmPrompt(input: ProduceGtmInput): string {
  return [
    "## Feature",
    JSON.stringify(input.feature, null, 2),
    "",
    "## Pricing plan (input — do NOT regenerate; caller will inject)",
    JSON.stringify(input.pricing, null, 2),
    "",
    "## Persona scores",
    JSON.stringify(input.scores, null, 2),
    input.competitors?.length
      ? "\n## Known competitors\n" + JSON.stringify(input.competitors, null, 2)
      : "",
    "",
    "## Output schema",
    "```ts",
    "interface GtmPlan {",
    "  featureId: string;        // caller sets",
    "  generatedAt: string;      // caller sets",
    "  positioning: string;      // 2-4 sentences naming the gap and the timing",
    "  pricing: PricingPlan;     // caller sets — omit from your output",
    "  launchSequence: {",
    "    week1Internal: string;          // sales + CS enablement",
    "    week2Beta: string;              // 10 named customer types + measurement",
    "    week3ControlledRelease: string; // instrumentation + thresholds",
    "    week4GeneralAvailability: string; // campaign brief + landing page wireframe summary",
    "  };",
    "  competitiveResponse: {",
    "    ignored: string;       // playbook if competitors ignore",
    "    copied: string;        // playbook if competitors copy within a quarter",
    "    leapfrogged: string;   // playbook if competitors leapfrog",
    "  };",
    "  risks: { kind: 'regulatory'|'data-privacy'|'infrastructure-cost'|'customer-confusion'|'cannibalization'|'other'; description: string; mitigation: string }[];",
    "  adversarialReview: { status: 'not-run' };  // caller sets",
    "}",
    "```",
    "",
    "Return ONE ```json``` block. Omit `pricing` and `adversarialReview` from your output (caller injects).",
  ]
    .filter(Boolean)
    .join("\n");
}

function renderGtmMarkdown(plan: GtmPlan): string {
  const status = plan.adversarialReview.status;
  return [
    `# Go-to-market plan — ${plan.featureId}`,
    "",
    `_Generated: ${plan.generatedAt}_  `,
    `_Adversarial review: **${status}**_`,
    status !== "passed-with-dissent"
      ? "\n> ⚠️ This plan has not yet passed adversarial review and is NOT ready to present.\n"
      : "",
    "## Positioning",
    plan.positioning,
    "",
    "## Pricing",
    "",
    "_Recommendation:_ " + plan.pricing.recommendation,
    "",
    ...plan.pricing.tiers.map(
      (t) =>
        `### ${t.tier} — ${t.pricePoint}\n\n${t.rationale}\n\n- Q1 impact: ${t.q1RevenueImpact}\n- Q4 impact: ${t.q4RevenueImpact}\n- Attach rates: ${Object.entries(
          t.attachRateBySegment,
        )
          .map(([k, v]) => `${k}: ${v}`)
          .join(", ")}\n`,
    ),
    "## Launch sequence",
    "",
    `- **Week 1 — Internal enablement:** ${plan.launchSequence.week1Internal}`,
    `- **Week 2 — Beta cohort:** ${plan.launchSequence.week2Beta}`,
    `- **Week 3 — Controlled release:** ${plan.launchSequence.week3ControlledRelease}`,
    `- **Week 4 — General availability:** ${plan.launchSequence.week4GeneralAvailability}`,
    "",
    "## Competitive response",
    "",
    `- **If ignored:** ${plan.competitiveResponse.ignored}`,
    `- **If copied within a quarter:** ${plan.competitiveResponse.copied}`,
    `- **If leapfrogged:** ${plan.competitiveResponse.leapfrogged}`,
    "",
    "## Risks",
    ...plan.risks.map(
      (r) => `- **${r.kind}** — ${r.description}\n  - _Mitigation:_ ${r.mitigation}`,
    ),
    "",
    "## Adversarial review",
    plan.adversarialReview.verdicts
      ? plan.adversarialReview.verdicts
          .map(
            (v) =>
              `- **${v.dimension}** — ${v.verdict.toUpperCase()}: ${v.argument}`,
          )
          .join("\n")
      : "_(not yet run)_",
  ]
    .filter(Boolean)
    .join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// adversarial_review
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_DIMENSIONS = [
  "market-fit",
  "technical-feasibility",
  "strategic-alignment",
  "customer-impact",
] as const;

export const AdversarialReviewInput = z.object({
  featureId: z.string().describe("Feature id whose GTM plan to review."),
  dimensions: z
    .array(z.string())
    .optional()
    .describe(
      "Critic dimensions. Defaults: market-fit, technical-feasibility, strategic-alignment, customer-impact.",
    ),
});
export type AdversarialReviewInput = z.infer<typeof AdversarialReviewInput>;

export interface AdversarialReviewOutput {
  plan: GtmPlan;
  storedAt: string;
  warning?: string;
}

export async function adversarialReview(
  ctx: ToolContext,
  input: AdversarialReviewInput,
): Promise<AdversarialReviewOutput> {
  const planFile = `${slug(input.featureId)}-gtm.json`;
  const plan = GtmPlanSchema.parse(await ctx.store.readJson("gtm", planFile));

  const dims = input.dimensions ?? DEFAULT_DIMENSIONS;
  const verdicts: NonNullable<GtmPlan["adversarialReview"]["verdicts"]> = [];

  for (const dimension of dims) {
    const raw = await ctx.llm.complete({
      purpose: `adversarial_review:${dimension}`,
      temperature: 0.5,
      maxTokens: 600,
      messages: [
        {
          role: "system",
          content: [
            `You are an ADVERSARIAL critic agent. Your dimension: ${dimension}.`,
            "Your job is to argue AGAINST this GTM plan from your dimension's point of view.",
            "Find the strongest reasons this should be killed or paused.",
            "Be specific. Cite numbers, segments, or assumptions in the plan.",
            "Output strictly valid JSON.",
          ].join("\n"),
        },
        {
          role: "user",
          content: [
            "## GTM plan to challenge",
            JSON.stringify(plan, null, 2),
            "",
            "## Output schema",
            "```ts",
            "interface Verdict {",
            "  dimension: string;",
            "  verdict: 'kill'|'concern'|'accept';",
            "  argument: string;       // 2-5 sentences",
            "}",
            "```",
            "",
            "Return ONE ```json``` block.",
          ].join("\n"),
        },
      ],
    });
    const v = extractJson<{ dimension: string; verdict: string; argument: string }>(raw);
    verdicts.push({
      dimension,
      verdict:
        v.verdict === "kill" || v.verdict === "concern" || v.verdict === "accept"
          ? v.verdict
          : "concern",
      argument: v.argument,
    });
  }

  // Enforcement: if every critic accepted, the filter is too loose.
  const dissented = verdicts.some(
    (v) => v.verdict === "kill" || v.verdict === "concern",
  );
  const killed = verdicts.some((v) => v.verdict === "kill");

  const status: GtmPlan["adversarialReview"]["status"] = killed
    ? "killed"
    : dissented
      ? "passed-with-dissent"
      : "filter-too-loose";

  plan.adversarialReview = {
    status,
    ranAt: new Date().toISOString(),
    verdicts,
  };

  const storedAt = await ctx.store.writeJson("gtm", planFile, plan);
  await ctx.store.writeText(
    "gtm",
    `${slug(input.featureId)}-gtm.md`,
    renderGtmMarkdown(plan),
  );

  let warning: string | undefined;
  if (status === "filter-too-loose") {
    warning =
      "FilterTooLooseWarning: every critic accepted the plan. Per Personakit safety policy, this plan should NOT be presented as-is. Re-run with harder critics, tighter dimensions, or revise the plan.";
  } else if (status === "killed") {
    warning =
      "Adversarial review returned a 'kill' verdict on at least one dimension. Address the killing concern before presenting.";
  }

  return { plan, storedAt, warning };
}
