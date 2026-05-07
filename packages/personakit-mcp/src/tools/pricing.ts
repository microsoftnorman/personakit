/**
 * Tool: produce_pricing — generate a 3-tier pricing plan from feature brief +
 * persona scores + market brief.
 */
import { z } from "zod";
import type { ToolContext } from "../context.js";
import { extractJson, slug } from "../context.js";
import {
  type MarketBrief,
  MarketBriefSchema,
  FeatureBriefSchema,
  type PricingPlan,
  PricingPlanSchema,
  PersonaScoreSchema,
} from "../types.js";

export const ProducePricingInput = z.object({
  feature: FeatureBriefSchema,
  scores: z.array(PersonaScoreSchema).min(1),
  marketBrief: MarketBriefSchema.optional(),
});
export type ProducePricingInput = z.infer<typeof ProducePricingInput>;

export interface ProducePricingOutput {
  plan: PricingPlan;
  storedAt: string;
}

export async function producePricing(
  ctx: ToolContext,
  input: ProducePricingInput,
): Promise<ProducePricingOutput> {
  const raw = await ctx.llm.complete({
    purpose: "produce_pricing",
    temperature: 0.4,
    maxTokens: 1_400,
    messages: [
      {
        role: "system",
        content: [
          "You are a pricing strategist drafting STARTING-POINT pricing scenarios.",
          "Be honest about uncertainty. Tie each tier to specific signals from the persona",
          "scores and (if provided) market brief. Output strictly valid JSON.",
          "Do NOT invent specific competitor financials beyond what the brief contains.",
        ].join("\n"),
      },
      {
        role: "user",
        content: buildPricingPrompt(input),
      },
    ],
  });

  const parsed = extractJson<unknown>(raw);
  const plan = PricingPlanSchema.parse({
    ...(parsed as object),
    featureId: input.feature.id,
    generatedAt: new Date().toISOString(),
  });
  const storedAt = await ctx.store.writeJson(
    "gtm",
    `${slug(input.feature.id)}-pricing.json`,
    plan,
  );
  return { plan, storedAt };
}

function buildPricingPrompt(input: ProducePricingInput): string {
  return [
    "## Feature",
    JSON.stringify(input.feature, null, 2),
    "",
    "## Persona scores",
    JSON.stringify(input.scores, null, 2),
    input.marketBrief
      ? "\n## Market brief\n" + JSON.stringify(input.marketBrief, null, 2)
      : "",
    "",
    "## Output schema",
    "```ts",
    "interface PricingPlan {",
    "  featureId: string;            // ignore — caller will set",
    "  generatedAt: string;          // ignore — caller will set",
    "  tiers: [PricingTier, PricingTier, PricingTier]; // exactly 3, named conservative/moderate/aggressive",
    "  recommendation: string;       // which tier and why, 2-4 sentences",
    "}",
    "interface PricingTier {",
    "  tier: 'conservative'|'moderate'|'aggressive';",
    "  pricePoint: string;           // e.g. '$10/seat/mo add-on', 'included in Business tier'",
    "  attachRateBySegment: Record<string,string>; // segment -> rough %",
    "  q1RevenueImpact: string;",
    "  q4RevenueImpact: string;",
    "  rationale: string;",
    "}",
    "```",
    "",
    "Return ONE ```json``` block.",
  ]
    .filter(Boolean)
    .join("\n");
}
