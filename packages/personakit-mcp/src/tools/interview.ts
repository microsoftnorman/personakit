/**
 * Tool: interview_persona — single-persona Q&A with sustained transcript.
 *
 * Each call appends to .personakit/transcripts/<sessionId>.md so a sequence of
 * interview_persona calls forms a real conversation.
 */
import { z } from "zod";
import type { ToolContext } from "../context.js";
import { newSessionId } from "../context.js";
import { type Persona, PersonaSchema } from "../types.js";

export const InterviewPersonaInput = z.object({
  personaId: z.string(),
  question: z.string().min(1),
  sessionId: z
    .string()
    .optional()
    .describe(
      "If omitted, a new session is created. Pass the same sessionId across calls to maintain conversation history.",
    ),
  context: z
    .string()
    .optional()
    .describe(
      "Optional extra context (e.g. a feature brief). Sent to the persona as additional system context for this turn.",
    ),
});
export type InterviewPersonaInput = z.infer<typeof InterviewPersonaInput>;

export interface InterviewPersonaOutput {
  sessionId: string;
  personaId: string;
  question: string;
  answer: string;
  transcriptPath: string;
}

export async function interviewPersona(
  ctx: ToolContext,
  input: InterviewPersonaInput,
): Promise<InterviewPersonaOutput> {
  const persona = PersonaSchema.parse(
    await ctx.store.readJson("personas", `${input.personaId}.json`),
  );
  const sessionId = input.sessionId ?? newSessionId(`int-${persona.id}`);
  const transcriptFile = `${sessionId}.md`;

  // Load any prior turns in this session.
  const prior = await readPriorTranscript(ctx, transcriptFile);

  const dossier = await ctx.store.readText("personas", `${persona.id}.md`);
  const systemPrompt = buildPersonaSystemPrompt(persona, dossier);

  const messages = [
    { role: "system" as const, content: systemPrompt },
    ...(input.context
      ? [
          {
            role: "system" as const,
            content: `Additional context for this turn:\n${input.context}`,
          },
        ]
      : []),
    ...prior,
    { role: "user" as const, content: input.question },
  ];

  const answer = await ctx.llm.complete({
    purpose: "interview_persona",
    temperature: 0.85,
    maxTokens: 1_200,
    messages,
  });

  const turnMd = [
    prior.length === 0
      ? `# Interview: ${persona.displayName} (${persona.archetype})\n\n_Session: ${sessionId} — started ${new Date().toISOString()}_\n`
      : "",
    `## Q (${new Date().toISOString()})`,
    input.question,
    "",
    `## A — ${persona.displayName}`,
    answer,
    "",
    "---",
    "",
  ]
    .filter(Boolean)
    .join("\n");
  const transcriptPath = await ctx.store.appendText(
    "transcripts",
    transcriptFile,
    turnMd,
  );

  return {
    sessionId,
    personaId: persona.id,
    question: input.question,
    answer,
    transcriptPath,
  };
}

function buildPersonaSystemPrompt(persona: Persona, dossier: string): string {
  return [
    `You are ${persona.displayName}, a ${persona.archetype} in the ${persona.segment} segment.`,
    "You are a SYNTHETIC PERSONA — an archetype, not a real individual.",
    "Speak in first person. Stay in character. React with your biases, priorities, and",
    "constraints. When you don't know, say so as this character would. Be specific.",
    "Reference your tools, prior experience, and decision criteria when relevant.",
    "Push back when something would not work for you — list specific objections.",
    "",
    "Your dossier:",
    "",
    dossier,
  ].join("\n");
}

async function readPriorTranscript(
  ctx: ToolContext,
  filename: string,
): Promise<Array<{ role: "user" | "assistant"; content: string }>> {
  if (!(await ctx.store.exists("transcripts", filename))) return [];
  const text = await ctx.store.readText("transcripts", filename);
  // Parse our own simple format: ## Q ... ## A —
  const turns: Array<{ role: "user" | "assistant"; content: string }> = [];
  const blocks = text.split(/\n---\n/);
  for (const block of blocks) {
    const qMatch = block.match(/## Q[^\n]*\n([\s\S]*?)\n## A/);
    const aMatch = block.match(/## A[^\n]*\n([\s\S]*?)$/);
    if (qMatch?.[1]) turns.push({ role: "user", content: qMatch[1].trim() });
    if (aMatch?.[1]) turns.push({ role: "assistant", content: aMatch[1].trim() });
  }
  return turns;
}
