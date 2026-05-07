#!/usr/bin/env node
/**
 * Personakit MCP server.
 *
 * Exposes 13 tools to Copilot:
 *   research_market, ingest_research, generate_personas, list_personas,
 *   get_persona, update_persona, delete_persona, interview_persona,
 *   panel_discussion, score_feature, produce_pricing, produce_gtm,
 *   adversarial_review.
 *
 * Transport: stdio (per MCP spec). Configured by plugins/personakit/.mcp.json
 * to be launched as `npx personakit-mcp` by the Copilot host.
 */
import process from "node:process";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { zodToJsonSchema } from "./util/zod-to-json-schema.js";
import { Audit } from "./audit.js";
import { Store } from "./store/index.js";
import {
  createLlmClientFromEnv,
  type LlmClient,
  MockLlmClient,
} from "./llm/client.js";
import type { ToolContext } from "./context.js";
import {
  IngestResearchInput,
  ResearchMarketInput,
  ingestResearch,
  researchMarket,
} from "./tools/research.js";
import {
  GeneratePersonasInput,
  GetPersonaInput,
  ListPersonasInput,
  UpdatePersonaInput,
  DeletePersonaInput,
  generatePersonas,
  getPersona,
  listPersonas,
  updatePersona,
  deletePersona,
} from "./tools/personas.js";
import {
  InterviewPersonaInput,
  interviewPersona,
} from "./tools/interview.js";
import { PanelDiscussionInput, panelDiscussion } from "./tools/panel.js";
import { ScoreFeatureInput, scoreFeature } from "./tools/feedback.js";
import { ProducePricingInput, producePricing } from "./tools/pricing.js";
import {
  AdversarialReviewInput,
  ProduceGtmInput,
  adversarialReview,
  produceGtm,
} from "./tools/gtm.js";
import type { ZodTypeAny } from "zod";

interface ToolDef {
  name: string;
  description: string;
  inputSchema: ZodTypeAny;
  handler: (ctx: ToolContext, input: unknown) => Promise<unknown>;
}

const TOOLS: ToolDef[] = [
  {
    name: "research_market",
    description:
      "Fetch optional public web sources and produce a structured MarketBrief (segment sizing, pain points, willingness-to-pay signals, competitor positioning). Stored under .personakit/research/.",
    inputSchema: ResearchMarketInput,
    handler: (ctx, input) => researchMarket(ctx, ResearchMarketInput.parse(input)),
  },
  {
    name: "ingest_research",
    description:
      "Read user-supplied research files (md, txt, csv, json) from the workspace, anonymize PII, and store them as research chunks under .personakit/research/.",
    inputSchema: IngestResearchInput,
    handler: (ctx, input) => ingestResearch(ctx, IngestResearchInput.parse(input)),
  },
  {
    name: "generate_personas",
    description:
      "Synthesize N persona dossiers from a product brief and (optionally) research files. Writes personas/<id>.md, personas/<id>.json, and agents/persona-<id>.agent.md.",
    inputSchema: GeneratePersonasInput,
    handler: (ctx, input) =>
      generatePersonas(ctx, GeneratePersonasInput.parse(input)),
  },
  {
    name: "list_personas",
    description: "List all generated personas (id, displayName, archetype, segment).",
    inputSchema: ListPersonasInput,
    handler: (ctx) => listPersonas(ctx),
  },
  {
    name: "get_persona",
    description: "Fetch one persona's structured record by id.",
    inputSchema: GetPersonaInput,
    handler: (ctx, input) => getPersona(ctx, GetPersonaInput.parse(input)),
  },
  {
    name: "update_persona",
    description:
      "Apply a partial update to an existing persona. Re-renders the dossier and the Copilot agent file so they stay in sync. The caller (typically the persona-manager agent) is responsible for showing the user a diff and getting confirmation before calling.",
    inputSchema: UpdatePersonaInput,
    handler: (ctx, input) =>
      updatePersona(ctx, UpdatePersonaInput.parse(input)),
  },
  {
    name: "delete_persona",
    description:
      "Delete a persona and its three files (dossier .md, structured .json, custom-agent .agent.md). Requires confirm=true; the caller MUST get explicit user confirmation first. Failing to confirm is a safety-policy violation.",
    inputSchema: DeletePersonaInput,
    handler: (ctx, input) =>
      deletePersona(ctx, DeletePersonaInput.parse(input)),
  },
  {
    name: "interview_persona",
    description:
      "Ask one persona a question. Maintains a transcript per sessionId so consecutive calls form a sustained conversation.",
    inputSchema: InterviewPersonaInput,
    handler: (ctx, input) =>
      interviewPersona(ctx, InterviewPersonaInput.parse(input)),
  },
  {
    name: "panel_discussion",
    description:
      "Run a round-robin multi-persona discussion on a topic. Returns the full transcript plus a structured summary (themes, agreements, disagreements, blockers).",
    inputSchema: PanelDiscussionInput,
    handler: (ctx, input) =>
      panelDiscussion(ctx, PanelDiscussionInput.parse(input)),
  },
  {
    name: "score_feature",
    description:
      "Per-persona structured scoring of a feature: usefulness, willingnessToPay, frictionPoints, wouldRecommend, rationale.",
    inputSchema: ScoreFeatureInput,
    handler: (ctx, input) => scoreFeature(ctx, ScoreFeatureInput.parse(input)),
  },
  {
    name: "produce_pricing",
    description:
      "Draft a 3-tier pricing plan (conservative, moderate, aggressive) with attach rates per segment and Q1/Q4 revenue impact.",
    inputSchema: ProducePricingInput,
    handler: (ctx, input) => producePricing(ctx, ProducePricingInput.parse(input)),
  },
  {
    name: "produce_gtm",
    description:
      "Draft a complete go-to-market plan: positioning, pricing, 4-week launch sequence, 3-scenario competitive response, risk analysis. Returns adversarialReview.status='not-run'; the caller MUST run adversarial_review next.",
    inputSchema: ProduceGtmInput,
    handler: (ctx, input) => produceGtm(ctx, ProduceGtmInput.parse(input)),
  },
  {
    name: "adversarial_review",
    description:
      "Run an adversarial critic panel against the saved GTM plan for a featureId. Per safety policy: if every critic accepts, the plan is marked 'filter-too-loose' and the caller is warned. Updates plan.adversarialReview.",
    inputSchema: AdversarialReviewInput,
    handler: (ctx, input) =>
      adversarialReview(ctx, AdversarialReviewInput.parse(input)),
  },
];

export interface BootOptions {
  workspaceRoot: string;
  llm?: LlmClient;
}

export function buildContext(opts: BootOptions): ToolContext {
  const store = new Store({ workspaceRoot: opts.workspaceRoot });
  const llm =
    opts.llm ??
    (process.env.PERSONAKIT_MOCK
      ? new MockLlmClient(() => '```json\n{"mock":true}\n```')
      : createLlmClientFromEnv(process.env));
  const audit = new Audit(store);
  return { store, llm, audit };
}

export async function main(): Promise<void> {
  const workspaceRoot = process.env.PERSONAKIT_WORKSPACE_ROOT ?? process.cwd();
  const ctx = buildContext({ workspaceRoot });
  await ctx.store.init();

  const server = new Server(
    { name: "personakit-mcp", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: zodToJsonSchema(t.inputSchema),
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const tool = TOOLS.find((t) => t.name === req.params.name);
    if (!tool) {
      return {
        isError: true,
        content: [{ type: "text", text: `Unknown tool: ${req.params.name}` }],
      };
    }
    const start = Date.now();
    try {
      const output = await tool.handler(ctx, req.params.arguments ?? {});
      await ctx.audit.record({
        tool: tool.name,
        inputs: req.params.arguments ?? {},
        outputs: output,
        durationMs: Date.now() - start,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await ctx.audit.record({
        tool: tool.name,
        inputs: req.params.arguments ?? {},
        outputs: null,
        error: msg,
        durationMs: Date.now() - start,
      });
      return {
        isError: true,
        content: [{ type: "text", text: msg }],
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// Run when invoked as a script. Keep guard so importing for tests doesn't boot.
if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}`) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });
}

export { TOOLS };
