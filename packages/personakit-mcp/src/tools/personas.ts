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

// ─────────────────────────────────────────────────────────────────────────────
// update_persona
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Partial-update schema: every field of Persona is optional except `id` is
 * implicit (passed separately). We deliberately re-export the Persona shape
 * here as a zod object so we can `.partial()` it without leaking
 * implementation details.
 */
const PersonaPatchSchema = PersonaSchema.partial().omit({ id: true });

export const UpdatePersonaInput = z.object({
  personaId: z.string(),
  patch: PersonaPatchSchema.describe(
    "Fields to overwrite on the persona. Anything omitted is left as-is.",
  ),
});
export type UpdatePersonaInput = z.infer<typeof UpdatePersonaInput>;

export interface UpdatePersonaOutput {
  persona: Persona;
  changedFields: string[];
  paths: { dossier: string; structured: string; agent: string };
}

/**
 * Apply a partial update to a persona. Re-renders the dossier and the
 * Copilot agent file so they stay in sync with the structured record.
 */
export async function updatePersona(
  ctx: ToolContext,
  input: UpdatePersonaInput,
): Promise<UpdatePersonaOutput> {
  const filename = `${input.personaId}.json`;
  if (!(await ctx.store.exists("personas", filename))) {
    throw new Error(
      `No persona with id '${input.personaId}'. Use list_personas to see the roster.`,
    );
  }
  const current = PersonaSchema.parse(
    await ctx.store.readJson("personas", filename),
  );

  // Shallow-merge top-level fields, with a one-level-deep merge for `demographics`.
  const merged: Persona = PersonaSchema.parse({
    ...current,
    ...input.patch,
    demographics: {
      ...current.demographics,
      ...(input.patch.demographics ?? {}),
    },
    id: current.id,
  });

  const changedFields = computeChangedFields(current, merged);
  if (changedFields.length === 0) {
    return {
      persona: current,
      changedFields,
      paths: {
        dossier: ctx.store.resolve("personas", `${current.id}.md`),
        structured: ctx.store.resolve("personas", `${current.id}.json`),
        agent: ctx.store.resolve("agents", `persona-${current.id}.agent.md`),
      },
    };
  }

  const dossierText = renderDossier(merged);
  // PII defence-in-depth: rescan the rerendered dossier.
  const dossierToWrite = looksAnonymized(dossierText)
    ? dossierText
    : anonymize(dossierText).text;

  const structured = await ctx.store.writeJson("personas", filename, merged);
  const dossier = await ctx.store.writeText(
    "personas",
    `${merged.id}.md`,
    dossierToWrite,
  );
  const agent = await writePersonaAgent(ctx, merged, dossierToWrite);

  return {
    persona: merged,
    changedFields,
    paths: { dossier, structured, agent },
  };
}

function computeChangedFields(before: Persona, after: Persona): string[] {
  const changed: string[] = [];
  for (const key of Object.keys(after) as Array<keyof Persona>) {
    if (key === "id") continue;
    const a = JSON.stringify(before[key]);
    const b = JSON.stringify(after[key]);
    if (a !== b) changed.push(String(key));
  }
  return changed;
}

// ─────────────────────────────────────────────────────────────────────────────
// delete_persona
// ─────────────────────────────────────────────────────────────────────────────

export const DeletePersonaInput = z.object({
  personaId: z.string(),
  /**
   * Required confirmation flag. The skill / Persona Manager agent must set
   * this to `true` after explicit user confirmation. Without it, the tool
   * refuses — preventing an LLM from accidentally deleting the roster.
   */
  confirm: z
    .literal(true)
    .describe(
      "Must be exactly true. Caller is responsible for confirming with the user first.",
    ),
});
export type DeletePersonaInput = z.infer<typeof DeletePersonaInput>;

export interface DeletePersonaOutput {
  personaId: string;
  removed: { dossier: boolean; structured: boolean; agent: boolean };
}

/**
 * Delete a persona's three files: dossier (.md), structured record (.json),
 * and the Copilot custom agent file (agents/persona-<id>.agent.md). All
 * three deletes are reported individually so the caller can audit which
 * actually existed.
 */
export async function deletePersona(
  ctx: ToolContext,
  input: DeletePersonaInput,
): Promise<DeletePersonaOutput> {
  const id = input.personaId;
  if (!(await ctx.store.exists("personas", `${id}.json`))) {
    throw new Error(
      `No persona with id '${id}'. Use list_personas to see the roster.`,
    );
  }
  const removed = {
    dossier: await ctx.store.deleteFile("personas", `${id}.md`),
    structured: await ctx.store.deleteFile("personas", `${id}.json`),
    agent: await ctx.store.deleteFile("agents", `persona-${id}.agent.md`),
  };
  return { personaId: id, removed };
}
