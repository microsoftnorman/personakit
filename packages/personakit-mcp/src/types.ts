/**
 * Shared domain types used across Personakit MCP tools.
 */
import { z } from "zod";

// ─────────────────────────────────────────────────────────────────────────────
// Market research
// ─────────────────────────────────────────────────────────────────────────────

export const MarketBriefSchema = z.object({
  topic: z.string(),
  segment: z.string(),
  generatedAt: z.string(),
  sources: z.array(
    z.object({
      kind: z.enum(["web", "user-doc"]),
      reference: z.string(), // URL or filename
      summary: z.string(),
    }),
  ),
  segmentSizing: z.string().optional(),
  painPoints: z.array(z.string()),
  willingnessToPay: z.array(z.string()),
  competitors: z.array(
    z.object({
      name: z.string(),
      positioning: z.string(),
      pricingNotes: z.string().optional(),
    }),
  ),
  notes: z.string().optional(),
});
export type MarketBrief = z.infer<typeof MarketBriefSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Personas
// ─────────────────────────────────────────────────────────────────────────────

export const PersonaSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  archetype: z.string(),
  segment: z.string(),
  // Demographic RANGES, not point values, per safety guardrail.
  demographics: z.object({
    ageRange: z.string(),
    geographyRange: z.string(),
    incomeRange: z.string().optional(),
    companySizeRange: z.string().optional(),
    role: z.string(),
    seniority: z.string(),
  }),
  background: z.string(),
  jobsToBeDone: z.array(z.string()),
  decisionCriteria: z.array(z.string()),
  biases: z.array(z.string()),
  communicationStyle: z.string(),
  antiPatterns: z.array(z.string()),
  sampleObjections: z.array(z.string()),
  toolsAndStack: z.array(z.string()),
  buyingAuthority: z.enum(["user", "influencer", "buyer", "economic-buyer"]),
  goToMarketNotes: z.string().optional(),
  generatedFromResearch: z.array(z.string()), // research source refs
});
export type Persona = z.infer<typeof PersonaSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Feature briefs and scoring
// ─────────────────────────────────────────────────────────────────────────────

export const FeatureBriefSchema = z.object({
  id: z.string(),
  name: z.string(),
  problem: z.string(),
  solution: z.string(),
  notes: z.string().optional(),
});
export type FeatureBrief = z.infer<typeof FeatureBriefSchema>;

export const PersonaScoreSchema = z.object({
  personaId: z.string(),
  usefulness: z.number().min(1).max(10),
  willingnessToPay: z.string(), // free text e.g. "$15/mo seat add-on"
  frictionPoints: z.array(z.string()),
  wouldRecommend: z.boolean(),
  rationale: z.string(),
});
export type PersonaScore = z.infer<typeof PersonaScoreSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Pricing
// ─────────────────────────────────────────────────────────────────────────────

export const PricingTierSchema = z.object({
  tier: z.enum(["conservative", "moderate", "aggressive"]),
  pricePoint: z.string(),
  attachRateBySegment: z.record(z.string(), z.string()),
  q1RevenueImpact: z.string(),
  q4RevenueImpact: z.string(),
  rationale: z.string(),
});
export type PricingTier = z.infer<typeof PricingTierSchema>;

export const PricingPlanSchema = z.object({
  featureId: z.string(),
  generatedAt: z.string(),
  tiers: z.array(PricingTierSchema).length(3),
  recommendation: z.string(),
});
export type PricingPlan = z.infer<typeof PricingPlanSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Go-to-market plan
// ─────────────────────────────────────────────────────────────────────────────

export const GtmPlanSchema = z.object({
  featureId: z.string(),
  generatedAt: z.string(),
  positioning: z.string(),
  pricing: PricingPlanSchema,
  launchSequence: z.object({
    week1Internal: z.string(),
    week2Beta: z.string(),
    week3ControlledRelease: z.string(),
    week4GeneralAvailability: z.string(),
  }),
  competitiveResponse: z.object({
    ignored: z.string(),
    copied: z.string(),
    leapfrogged: z.string(),
  }),
  risks: z.array(
    z.object({
      kind: z.enum([
        "regulatory",
        "data-privacy",
        "infrastructure-cost",
        "customer-confusion",
        "cannibalization",
        "other",
      ]),
      description: z.string(),
      mitigation: z.string(),
    }),
  ),
  /**
   * Set by `adversarial_review` after the plan has been challenged. The
   * `personakit-go-to-market` skill refuses to present a plan whose
   * `adversarialReview.status !== "passed-with-dissent"`.
   */
  adversarialReview: z
    .object({
      status: z.enum([
        "not-run",
        "passed-with-dissent",
        "filter-too-loose",
        "killed",
      ]),
      ranAt: z.string().optional(),
      verdicts: z
        .array(
          z.object({
            dimension: z.string(),
            verdict: z.enum(["kill", "concern", "accept"]),
            argument: z.string(),
          }),
        )
        .optional(),
    })
    .default({ status: "not-run" }),
});
export type GtmPlan = z.infer<typeof GtmPlanSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Panel discussion
// ─────────────────────────────────────────────────────────────────────────────

export const PanelTurnSchema = z.object({
  round: z.number(),
  personaId: z.string(),
  text: z.string(),
});
export type PanelTurn = z.infer<typeof PanelTurnSchema>;

export const PanelSummarySchema = z.object({
  themes: z.array(z.string()),
  agreements: z.array(z.string()),
  disagreements: z.array(z.string()),
  blockers: z.array(z.string()),
});
export type PanelSummary = z.infer<typeof PanelSummarySchema>;

export const PanelTranscriptSchema = z.object({
  sessionId: z.string(),
  topic: z.string(),
  startedAt: z.string(),
  participants: z.array(z.string()),
  turns: z.array(PanelTurnSchema),
  summary: PanelSummarySchema,
});
export type PanelTranscript = z.infer<typeof PanelTranscriptSchema>;
