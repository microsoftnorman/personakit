/**
 * Tools: generate_personas, list_personas, get_persona.
 *
 * generate_personas synthesizes N persona dossiers from a product brief and
 * (optionally) one or more research files. Each persona is written as:
 *   - personas/<id>.md   — narrative dossier (used as the persona agent's system prompt)
 *   - personas/<id>.json — structured fields
 *   - agents/<id>.agent.md — a Copilot custom-agent file cloned from the
 *     persona-template, with the dossier embedded as system prompt.
 */
import { z } from "zod";
import { anonymize, looksAnonymized } from "../safety/anonymize.js";
import type { ToolContext } from "../context.js";
import { extractJson, slug } from "../context.js";
import {
  type MarketBrief,
  type Persona,
  PersonaSchema,
} from "../types.js";

export const GeneratePersonasInput = z.object({
  productBrief: z
    .string()
    .describe("Free-text description of the product the personas are for."),
  count: z.number().int().min(1).max(20).default(5),
  archetypes: z
    .array(z.string())
    .optional()
    .describe(
      "Optional archetype hints, e.g. ['Mid-market Ops Director', 'Enterprise Sr Engineer'].",
    ),
  researchFiles: z
    .array(z.string())
    .optional()
    .describe("Filenames under .personakit/research/ to ground the personas in."),
  marketBriefFiles: z
    .array(z.string())
    .optional()
    .describe(
      "Filenames under .personakit/research/ that contain MarketBrief JSON.",
    ),
});
export type GeneratePersonasInput = z.infer<typeof GeneratePersonasInput>;

export interface GeneratePersonasOutput {
  personas: Persona[];
  paths: { dossier: string; structured: string; agent: string }[];
  warnings: string[];
}

export async function generatePersonas(
  ctx: ToolContext,
  input: GeneratePersonasInput,
): Promise<GeneratePersonasOutput> {
  const research = await loadResearchContext(ctx, input);

  const raw = await ctx.llm.complete({
    purpose: "generate_personas",
    temperature: 0.8,
    maxTokens: 4_500,
    messages: [
      {
        role: "system",
        content: [
          "You are a senior product researcher creating SYNTHETIC personas for product validation.",
          "Hard rules:",
          "- Personas are archetypes, NOT real people. Never use real names of real public figures or named individuals from research.",
          "- Demographics MUST be ranges (e.g. '35-45', 'major North American metros'), never point values.",
          "- Personas should reflect behaviors, biases, and decision criteria — not just bios.",
          "- Each persona must include at least 3 specific objections they would raise to weak product ideas.",
          "Output strictly valid JSON. Do not invent specific company financials.",
        ].join("\n"),
      },
      {
        role: "user",
        content: buildPersonaPrompt(input, research),
      },
    ],
  });

  const parsed = extractJson<{ personas: Persona[] }>(raw);
  if (!parsed || !Array.isArray(parsed.personas)) {
    throw new Error("LLM did not return { personas: Persona[] }");
  }

  const personas: Persona[] = [];
  const paths: GeneratePersonasOutput["paths"] = [];
  const warnings: string[] = [];

  for (const candidate of parsed.personas) {
    const persona = PersonaSchema.parse({
      ...candidate,
      id: candidate.id ?? slug(candidate.displayName ?? candidate.archetype ?? "persona"),
    });

    // Anonymization defence-in-depth: re-scan the dossier text.
    const dossierText = renderDossier(persona);
    if (!looksAnonymized(dossierText)) {
      const cleaned = anonymize(dossierText).text;
      const dossierPath = await ctx.store.writeText(
        "personas",
        `${persona.id}.md`,
        cleaned,
      );
      warnings.push(
        `Persona ${persona.id} contained PII-shaped content; redacted before write.`,
      );
      const structuredPath = await ctx.store.writeJson(
        "personas",
        `${persona.id}.json`,
        persona,
      );
      const agentPath = await writePersonaAgent(ctx, persona, cleaned);
      paths.push({ dossier: dossierPath, structured: structuredPath, agent: agentPath });
    } else {
      const dossierPath = await ctx.store.writeText(
        "personas",
        `${persona.id}.md`,
        dossierText,
      );
      const structuredPath = await ctx.store.writeJson(
        "personas",
        `${persona.id}.json`,
        persona,
      );
      const agentPath = await writePersonaAgent(ctx, persona, dossierText);
      paths.push({ dossier: dossierPath, structured: structuredPath, agent: agentPath });
    }
    personas.push(persona);
  }

  return { personas, paths, warnings };
}

async function loadResearchContext(
  ctx: ToolContext,
  input: GeneratePersonasInput,
): Promise<{ marketBriefs: MarketBrief[]; rawDocs: string[] }> {
  const marketBriefs: MarketBrief[] = [];
  for (const f of input.marketBriefFiles ?? []) {
    try {
      marketBriefs.push(await ctx.store.readJson<MarketBrief>("research", f));
    } catch {
      // skip missing
    }
  }
  const rawDocs: string[] = [];
  for (const f of input.researchFiles ?? []) {
    try {
      rawDocs.push(await ctx.store.readText("research", f));
    } catch {
      // skip
    }
  }
  return { marketBriefs, rawDocs };
}

function buildPersonaPrompt(
  input: GeneratePersonasInput,
  research: { marketBriefs: MarketBrief[]; rawDocs: string[] },
): string {
  const briefBlock =
    research.marketBriefs.length === 0
      ? ""
      : "## Market briefs\n" +
        research.marketBriefs
          .map((b, i) => `### Brief ${i + 1}\n\n${JSON.stringify(b, null, 2)}`)
          .join("\n\n");
  const docBlock =
    research.rawDocs.length === 0
      ? ""
      : "## Research excerpts\n" +
        research.rawDocs
          .map((d, i) => `### Doc ${i + 1}\n\n${d.slice(0, 3_000)}`)
          .join("\n\n");

  return [
    `Generate ${input.count} synthetic personas for the product below.`,
    "",
    "## Product brief",
    input.productBrief,
    input.archetypes?.length
      ? `\n## Required archetypes (one persona each)\n- ${input.archetypes.join("\n- ")}`
      : "",
    briefBlock,
    docBlock,
    "",
    "## Output schema",
    "```ts",
    "interface Persona {",
    "  id: string;            // slug; lowercase-with-dashes",
    "  displayName: string;   // first name only or 'First L.' style",
    "  archetype: string;",
    "  segment: string;",
    "  demographics: {",
    "    ageRange: string;            // RANGE only, e.g. '38-46'",
    "    geographyRange: string;      // e.g. 'major US metros'",
    "    incomeRange?: string;        // RANGE only",
    "    companySizeRange?: string;",
    "    role: string;",
    "    seniority: string;",
    "  };",
    "  background: string;            // 3-6 sentences",
    "  jobsToBeDone: string[];        // 3-7 items",
    "  decisionCriteria: string[];    // 3-7 items",
    "  biases: string[];              // 2-5 items",
    "  communicationStyle: string;",
    "  antiPatterns: string[];        // things they hate",
    "  sampleObjections: string[];    // 3-6 specific objections",
    "  toolsAndStack: string[];",
    "  buyingAuthority: 'user'|'influencer'|'buyer'|'economic-buyer';",
    "  goToMarketNotes?: string;",
    "  generatedFromResearch: string[]; // brief refs used",
    "}",
    "```",
    "",
    `Return ONE \`\`\`json\`\`\` block of shape: { "personas": Persona[] } with exactly ${input.count} entries.`,
  ]
    .filter(Boolean)
    .join("\n");
}

function renderDossier(persona: Persona): string {
  return [
    `# ${persona.displayName} — ${persona.archetype}`,
    "",
    `**Segment:** ${persona.segment}  `,
    `**Buying authority:** ${persona.buyingAuthority}  `,
    `**Role:** ${persona.demographics.role} (${persona.demographics.seniority})`,
    "",
    "## Demographics (ranges only)",
    `- Age: ${persona.demographics.ageRange}`,
    `- Geography: ${persona.demographics.geographyRange}`,
    persona.demographics.incomeRange
      ? `- Income: ${persona.demographics.incomeRange}`
      : "",
    persona.demographics.companySizeRange
      ? `- Company size: ${persona.demographics.companySizeRange}`
      : "",
    "",
    "## Background",
    persona.background,
    "",
    "## Jobs to be done",
    ...persona.jobsToBeDone.map((j) => `- ${j}`),
    "",
    "## Decision criteria",
    ...persona.decisionCriteria.map((j) => `- ${j}`),
    "",
    "## Biases",
    ...persona.biases.map((j) => `- ${j}`),
    "",
    "## Communication style",
    persona.communicationStyle,
    "",
    "## Anti-patterns (things they reject)",
    ...persona.antiPatterns.map((j) => `- ${j}`),
    "",
    "## Sample objections",
    ...persona.sampleObjections.map((j) => `- ${j}`),
    "",
    "## Tools & stack",
    ...persona.toolsAndStack.map((j) => `- ${j}`),
    persona.goToMarketNotes
      ? "\n## Go-to-market notes\n" + persona.goToMarketNotes
      : "",
    "",
    "## Provenance",
    "Generated from: " +
      (persona.generatedFromResearch.length
        ? persona.generatedFromResearch.join(", ")
        : "(no specific research refs)"),
  ]
    .filter((l) => l !== "")
    .join("\n");
}

async function writePersonaAgent(
  ctx: ToolContext,
  persona: Persona,
  dossier: string,
): Promise<string> {
  const agentMd = [
    "---",
    `name: persona-${persona.id}`,
    `description: |`,
    `  Synthetic customer persona: ${persona.displayName} (${persona.archetype}).`,
    `  Use when the user wants to interview, role-play with, or get reactions from`,
    `  this persona. The persona stays in character; do NOT break character to`,
    `  give product advice — instead, react as ${persona.displayName} would.`,
    `tools: ["interview_persona", "get_persona"]`,
    "---",
    "",
    `# You are ${persona.displayName} — ${persona.archetype}`,
    "",
    "You are a SYNTHETIC PERSONA. You speak in first person as this character.",
    "Stay in character at all times. When asked product questions, respond as",
    "this person would — with their biases, priorities, and constraints.",
    "Do NOT pretend to be a real, named individual; you are an archetype.",
    "",
    "Your dossier is below. Internalize it before responding.",
    "",
    "---",
    "",
    dossier,
  ].join("\n");
  return ctx.store.writeText("agents", `persona-${persona.id}.agent.md`, agentMd);
}

// ─────────────────────────────────────────────────────────────────────────────
// list_personas, get_persona
// ─────────────────────────────────────────────────────────────────────────────

export const ListPersonasInput = z.object({});
export type ListPersonasInput = z.infer<typeof ListPersonasInput>;

export async function listPersonas(
  ctx: ToolContext,
): Promise<{ personas: Array<Pick<Persona, "id" | "displayName" | "archetype" | "segment">> }> {
  const files = await ctx.store.list("personas");
  const personas: Array<Pick<Persona, "id" | "displayName" | "archetype" | "segment">> = [];
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    try {
      const p = await ctx.store.readJson<Persona>("personas", f);
      personas.push({
        id: p.id,
        displayName: p.displayName,
        archetype: p.archetype,
        segment: p.segment,
      });
    } catch {
      // skip malformed
    }
  }
  return { personas };
}

export const GetPersonaInput = z.object({
  personaId: z.string(),
});
export type GetPersonaInput = z.infer<typeof GetPersonaInput>;

export async function getPersona(
  ctx: ToolContext,
  input: GetPersonaInput,
): Promise<Persona> {
  return ctx.store.readJson<Persona>("personas", `${input.personaId}.json`);
}
