/**
 * Tool: score_feature — per-persona structured scoring of a feature brief.
 */
import { z } from "zod";
import type { ToolContext } from "../context.js";
import { extractJson, slug } from "../context.js";
import {
  type FeatureBrief,
  FeatureBriefSchema,
  type PersonaScore,
  PersonaScoreSchema,
  PersonaSchema,
} from "../types.js";

export const ScoreFeatureInput = z.object({
  feature: FeatureBriefSchema,
  personaIds: z.array(z.string()).min(1),
});
export type ScoreFeatureInput = z.infer<typeof ScoreFeatureInput>;

export interface ScoreFeatureOutput {
  scores: PersonaScore[];
  storedAt: string;
}

export async function scoreFeature(
  ctx: ToolContext,
  input: ScoreFeatureInput,
): Promise<ScoreFeatureOutput> {
  const scores: PersonaScore[] = [];
  for (const personaId of input.personaIds) {
    const persona = PersonaSchema.parse(
      await ctx.store.readJson("personas", `${personaId}.json`),
    );
    const dossier = await ctx.store.readText("personas", `${personaId}.md`);
    const raw = await ctx.llm.complete({
      purpose: `score_feature:${personaId}`,
      temperature: 0.6,
      maxTokens: 700,
      messages: [
        {
          role: "system",
          content: [
            `You are ${persona.displayName} — ${persona.archetype} (${persona.segment}).`,
            "Score the feature below from your point of view. Be specific and honest.",
            "Output strictly valid JSON.",
            "",
            "Your dossier:",
            "",
            dossier,
          ].join("\n"),
        },
        {
          role: "user",
          content: buildScorePrompt(input.feature),
        },
      ],
    });
    const parsed = extractJson<unknown>(raw);
    const score = PersonaScoreSchema.parse({
      ...(parsed as object),
      personaId,
    });
    scores.push(score);
  }

  const storedAt = await ctx.store.writeJson(
    "feedback",
    `${slug(input.feature.id)}-scores.json`,
    { feature: input.feature, scores, generatedAt: new Date().toISOString() },
  );
  return { scores, storedAt };
}

function buildScorePrompt(feature: FeatureBrief): string {
  return [
    `## Feature: ${feature.name}`,
    "",
    "**Problem:** " + feature.problem,
    "",
    "**Solution:** " + feature.solution,
    feature.notes ? "\n**Notes:** " + feature.notes : "",
    "",
    "## Output schema",
    "```ts",
    "interface PersonaScore {",
    "  usefulness: number;       // 1..10 from your point of view",
    "  willingnessToPay: string; // free text, e.g. '$15/seat/mo add-on' or 'no, expect in base'",
    "  frictionPoints: string[]; // 2-5 specific issues",
    "  wouldRecommend: boolean;  // would you recommend it to a peer in your segment?",
    "  rationale: string;        // 2-4 sentences in your voice",
    "}",
    "```",
    "",
    "Return ONE ```json``` block.",
  ]
    .filter(Boolean)
    .join("\n");
}
