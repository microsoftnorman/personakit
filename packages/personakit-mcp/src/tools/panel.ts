/**
 * Tool: panel_discussion — round-robin multi-persona discussion.
 *
 * Implementation note: each persona's turn is its own LLM call with that
 * persona's system prompt + the running transcript. This produces real
 * persona-vs-persona text rather than one model narrating multiple voices.
 *
 * For users who want to escalate to "real" agent-to-agent chat, the
 * pm-orchestrator agent can instead invoke each persona's custom Copilot
 * subagent via runSubagent. This MCP-side panel is the lighter-weight default.
 */
import { z } from "zod";
import type { ToolContext } from "../context.js";
import { extractJson, newSessionId } from "../context.js";
import {
  type PanelTranscript,
  type PanelTurn,
  type Persona,
  PanelSummarySchema,
  PersonaSchema,
} from "../types.js";

export const PanelDiscussionInput = z.object({
  personaIds: z.array(z.string()).min(2),
  topic: z
    .string()
    .describe("Free-text topic, e.g. 'auto-Gantt feature'."),
  rounds: z.number().int().min(1).max(6).default(3),
  featureBrief: z
    .string()
    .optional()
    .describe("Optional feature brief context to add to each persona's prompt."),
});
export type PanelDiscussionInput = z.infer<typeof PanelDiscussionInput>;

export interface PanelDiscussionOutput {
  transcript: PanelTranscript;
  transcriptPath: string;
}

export async function panelDiscussion(
  ctx: ToolContext,
  input: PanelDiscussionInput,
): Promise<PanelDiscussionOutput> {
  const personas: Persona[] = [];
  for (const id of input.personaIds) {
    personas.push(
      PersonaSchema.parse(await ctx.store.readJson("personas", `${id}.json`)),
    );
  }

  const sessionId = newSessionId("panel");
  const turns: PanelTurn[] = [];

  for (let round = 1; round <= input.rounds; round++) {
    for (const persona of personas) {
      const dossier = await ctx.store.readText("personas", `${persona.id}.md`);
      const system = [
        `You are ${persona.displayName} — ${persona.archetype} (${persona.segment}).`,
        "You are participating in a moderated panel discussion with other synthetic personas.",
        "Stay in character. Be concise (3-6 sentences). React to specific things",
        "other panelists said when relevant. Disagree when you would disagree —",
        "do not paper over conflicts.",
        "",
        "Your dossier:",
        "",
        dossier,
      ].join("\n");

      const transcriptSoFar = renderTranscriptForPrompt(turns, personas);
      const userTurn = [
        `Topic: ${input.topic}`,
        input.featureBrief
          ? `\nFeature brief:\n${input.featureBrief}\n`
          : "",
        transcriptSoFar
          ? `\nTranscript so far:\n${transcriptSoFar}\n`
          : "\n(You speak first.)\n",
        `\nRound ${round}. Speak now as ${persona.displayName}.`,
      ]
        .filter(Boolean)
        .join("");

      const text = await ctx.llm.complete({
        purpose: `panel_discussion:r${round}:${persona.id}`,
        temperature: 0.85,
        maxTokens: 600,
        messages: [
          { role: "system", content: system },
          { role: "user", content: userTurn },
        ],
      });
      turns.push({ round, personaId: persona.id, text: text.trim() });
    }
  }

  const summary = await summarizePanel(ctx, input.topic, personas, turns);

  const transcript: PanelTranscript = {
    sessionId,
    topic: input.topic,
    startedAt: new Date().toISOString(),
    participants: personas.map((p) => p.id),
    turns,
    summary,
  };

  const md = renderTranscriptMarkdown(transcript, personas);
  const transcriptPath = await ctx.store.writeText(
    "transcripts",
    `${sessionId}.md`,
    md,
  );
  await ctx.store.writeJson(
    "transcripts",
    `${sessionId}.json`,
    transcript,
  );

  return { transcript, transcriptPath };
}

function renderTranscriptForPrompt(turns: PanelTurn[], personas: Persona[]): string {
  if (turns.length === 0) return "";
  return turns
    .map((t) => {
      const p = personas.find((x) => x.id === t.personaId);
      return `[R${t.round} — ${p?.displayName ?? t.personaId}]: ${t.text}`;
    })
    .join("\n\n");
}

function renderTranscriptMarkdown(
  transcript: PanelTranscript,
  personas: Persona[],
): string {
  const head = [
    `# Panel discussion — ${transcript.topic}`,
    "",
    `_Session: ${transcript.sessionId} — ${transcript.startedAt}_`,
    "",
    "## Participants",
    ...transcript.participants.map((id) => {
      const p = personas.find((x) => x.id === id);
      return `- **${p?.displayName ?? id}** — ${p?.archetype ?? "?"}`;
    }),
    "",
    "## Transcript",
  ];
  const body = transcript.turns.map((t) => {
    const p = personas.find((x) => x.id === t.personaId);
    return `### Round ${t.round} — ${p?.displayName ?? t.personaId}\n\n${t.text}\n`;
  });
  const summary = [
    "",
    "## Summary",
    "",
    "### Themes",
    ...transcript.summary.themes.map((s) => `- ${s}`),
    "",
    "### Agreements",
    ...transcript.summary.agreements.map((s) => `- ${s}`),
    "",
    "### Disagreements",
    ...transcript.summary.disagreements.map((s) => `- ${s}`),
    "",
    "### Blockers",
    ...transcript.summary.blockers.map((s) => `- ${s}`),
  ];
  return [...head, ...body, ...summary].join("\n");
}

async function summarizePanel(
  ctx: ToolContext,
  topic: string,
  personas: Persona[],
  turns: PanelTurn[],
) {
  const transcript = renderTranscriptForPrompt(turns, personas);
  const raw = await ctx.llm.complete({
    purpose: "panel_discussion:summary",
    temperature: 0.3,
    maxTokens: 900,
    messages: [
      {
        role: "system",
        content:
          "You distill panel discussions. Return strictly valid JSON with the schema in the user prompt. Be specific; use direct phrases from the transcript when possible.",
      },
      {
        role: "user",
        content: [
          `Topic: ${topic}`,
          "",
          "Transcript:",
          transcript,
          "",
          "Schema:",
          "```ts",
          "interface PanelSummary {",
          "  themes: string[];",
          "  agreements: string[];",
          "  disagreements: string[];   // MUST contain at least 1 if any divergence existed",
          "  blockers: string[];",
          "}",
          "```",
          "",
          "Return ONE ```json``` block.",
        ].join("\n"),
      },
    ],
  });
  return PanelSummarySchema.parse(extractJson(raw));
}
