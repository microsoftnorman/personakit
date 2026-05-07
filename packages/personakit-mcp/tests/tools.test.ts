import { mkdtempSync, rmSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Audit } from "../src/audit.js";
import { Store } from "../src/store/index.js";
import { MockLlmClient } from "../src/llm/client.js";
import { generatePersonas } from "../src/tools/personas.js";
import { panelDiscussion } from "../src/tools/panel.js";
import { produceGtm } from "../src/tools/gtm.js";
import { adversarialReview } from "../src/tools/gtm.js";
import type { PricingPlan } from "../src/types.js";

function ctx(tmp: string, mock: MockLlmClient) {
  const store = new Store({ workspaceRoot: tmp });
  return { store, llm: mock, audit: new Audit(store) };
}

describe("personas + panel + GTM happy path", () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = mkdtempSync(path.join(os.tmpdir(), "personakit-test-"));
    const store = new Store({ workspaceRoot: tmp });
    await store.init();
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("generate_personas writes dossier, json, and agent files for each persona", async () => {
    const mock = new MockLlmClient(() =>
      "```json\n" +
        JSON.stringify({
          personas: [
            {
              id: "maya",
              displayName: "Maya",
              archetype: "Mid-market Ops Director",
              segment: "mid-market SaaS",
              demographics: {
                ageRange: "38-46",
                geographyRange: "major US metros",
                companySizeRange: "100-300",
                role: "Operations Director",
                seniority: "Director",
              },
              background: "Twenty-year ops career across two SaaS scale-ups.",
              jobsToBeDone: ["keep PM tool in sync", "report status weekly"],
              decisionCriteria: ["onboarding cost", "integrations"],
              biases: ["distrusts ai-as-magic"],
              communicationStyle: "Direct.",
              antiPatterns: ["another module to manage"],
              sampleObjections: [
                "if onboarding > 1 sprint, no",
                "needs to write back to source",
                "won't pay for AI separately",
              ],
              toolsAndStack: ["Linear", "Asana", "Slack"],
              buyingAuthority: "buyer",
              generatedFromResearch: ["analyst-snippet"],
            },
          ],
        }) +
        "\n```",
    );

    const result = await generatePersonas(ctx(tmp, mock), {
      productBrief: "Tessera — mid-market PM SaaS",
      count: 1,
    });

    expect(result.personas).toHaveLength(1);
    expect(result.personas[0]?.id).toBe("maya");
    expect(result.paths[0]?.dossier.endsWith("maya.md")).toBe(true);
    expect(result.paths[0]?.structured.endsWith("maya.json")).toBe(true);
    expect(result.paths[0]?.agent.endsWith("persona-maya.agent.md")).toBe(true);
  });

  it("panel_discussion generates one turn per persona per round", async () => {
    // First, write two persona records to the store.
    const store = new Store({ workspaceRoot: tmp });
    for (const id of ["alpha", "beta"]) {
      const persona = {
        id,
        displayName: id,
        archetype: "Test",
        segment: "test",
        demographics: {
          ageRange: "30-40",
          geographyRange: "anywhere",
          role: "tester",
          seniority: "Senior",
        },
        background: "test",
        jobsToBeDone: ["test"],
        decisionCriteria: ["test"],
        biases: ["test"],
        communicationStyle: "test",
        antiPatterns: ["test"],
        sampleObjections: ["a", "b", "c"],
        toolsAndStack: ["test"],
        buyingAuthority: "user" as const,
        generatedFromResearch: [],
      };
      await store.writeJson("personas", `${id}.json`, persona);
      await store.writeText("personas", `${id}.md`, "# dossier");
    }

    let i = 0;
    const mock = new MockLlmClient((opts) => {
      if (opts.purpose?.startsWith("panel_discussion:summary")) {
        return (
          "```json\n" +
          JSON.stringify({
            themes: ["t1"],
            agreements: [],
            disagreements: ["d1"],
            blockers: [],
          }) +
          "\n```"
        );
      }
      return `Turn ${++i}`;
    });

    const out = await panelDiscussion(ctx(tmp, mock), {
      personaIds: ["alpha", "beta"],
      topic: "auto-Gantt",
      rounds: 2,
    });

    expect(out.transcript.turns).toHaveLength(4); // 2 personas × 2 rounds
    expect(out.transcript.turns.map((t) => t.personaId)).toEqual([
      "alpha",
      "beta",
      "alpha",
      "beta",
    ]);
    expect(out.transcript.summary.disagreements).toContain("d1");
  });

  it("produce_gtm always returns adversarialReview.status='not-run'", async () => {
    const mock = new MockLlmClient(() => {
      return (
        "```json\n" +
        JSON.stringify({
          positioning: "p",
          launchSequence: {
            week1Internal: "a",
            week2Beta: "b",
            week3ControlledRelease: "c",
            week4GeneralAvailability: "d",
          },
          competitiveResponse: { ignored: "i", copied: "c", leapfrogged: "l" },
          risks: [{ kind: "other", description: "x", mitigation: "y" }],
        }) +
        "\n```"
      );
    });

    const pricing: PricingPlan = {
      featureId: "f1",
      generatedAt: new Date().toISOString(),
      tiers: [
        {
          tier: "conservative",
          pricePoint: "$0",
          attachRateBySegment: { all: "10%" },
          q1RevenueImpact: "low",
          q4RevenueImpact: "low",
          rationale: "x",
        },
        {
          tier: "moderate",
          pricePoint: "$10",
          attachRateBySegment: { all: "20%" },
          q1RevenueImpact: "med",
          q4RevenueImpact: "med",
          rationale: "x",
        },
        {
          tier: "aggressive",
          pricePoint: "$20",
          attachRateBySegment: { all: "5%" },
          q1RevenueImpact: "low",
          q4RevenueImpact: "low",
          rationale: "x",
        },
      ],
      recommendation: "moderate",
    };

    const out = await produceGtm(ctx(tmp, mock), {
      feature: { id: "f1", name: "F1", problem: "p", solution: "s" },
      pricing,
      scores: [
        {
          personaId: "maya",
          usefulness: 7,
          willingnessToPay: "$10",
          frictionPoints: ["onboarding"],
          wouldRecommend: true,
          rationale: "ok",
        },
      ],
    });

    expect(out.plan.adversarialReview.status).toBe("not-run");
    expect(out.warning).toContain("MUST call adversarial_review");
  });

  it("adversarial_review marks 'filter-too-loose' when every critic accepts", async () => {
    // First seed a GTM plan.
    const mockGtm = new MockLlmClient(() =>
      "```json\n" +
      JSON.stringify({
        positioning: "p",
        launchSequence: {
          week1Internal: "a",
          week2Beta: "b",
          week3ControlledRelease: "c",
          week4GeneralAvailability: "d",
        },
        competitiveResponse: { ignored: "i", copied: "c", leapfrogged: "l" },
        risks: [{ kind: "other", description: "x", mitigation: "y" }],
      }) +
      "\n```",
    );
    const pricing: PricingPlan = {
      featureId: "f2",
      generatedAt: new Date().toISOString(),
      tiers: [
        { tier: "conservative", pricePoint: "$0", attachRateBySegment: { all: "0%" }, q1RevenueImpact: "0", q4RevenueImpact: "0", rationale: "x" },
        { tier: "moderate", pricePoint: "$0", attachRateBySegment: { all: "0%" }, q1RevenueImpact: "0", q4RevenueImpact: "0", rationale: "x" },
        { tier: "aggressive", pricePoint: "$0", attachRateBySegment: { all: "0%" }, q1RevenueImpact: "0", q4RevenueImpact: "0", rationale: "x" },
      ],
      recommendation: "x",
    };
    await produceGtm(ctx(tmp, mockGtm), {
      feature: { id: "f2", name: "F2", problem: "p", solution: "s" },
      pricing,
      scores: [
        { personaId: "x", usefulness: 5, willingnessToPay: "x", frictionPoints: ["x"], wouldRecommend: true, rationale: "x" },
      ],
    });

    // Now critic that always accepts.
    const mockCritic = new MockLlmClient(() =>
      '```json\n{"dimension":"market-fit","verdict":"accept","argument":"looks fine"}\n```',
    );

    const out = await adversarialReview(ctx(tmp, mockCritic), {
      featureId: "f2",
      dimensions: ["market-fit", "technical-feasibility"],
    });

    expect(out.plan.adversarialReview.status).toBe("filter-too-loose");
    expect(out.warning).toContain("FilterTooLooseWarning");
  });

  it("adversarial_review marks 'killed' when any critic returns kill", async () => {
    const mockGtm = new MockLlmClient(() =>
      "```json\n" +
      JSON.stringify({
        positioning: "p",
        launchSequence: { week1Internal: "a", week2Beta: "b", week3ControlledRelease: "c", week4GeneralAvailability: "d" },
        competitiveResponse: { ignored: "i", copied: "c", leapfrogged: "l" },
        risks: [{ kind: "other", description: "x", mitigation: "y" }],
      }) + "\n```",
    );
    const pricing: PricingPlan = {
      featureId: "f3",
      generatedAt: new Date().toISOString(),
      tiers: [
        { tier: "conservative", pricePoint: "$0", attachRateBySegment: { all: "0%" }, q1RevenueImpact: "0", q4RevenueImpact: "0", rationale: "x" },
        { tier: "moderate", pricePoint: "$0", attachRateBySegment: { all: "0%" }, q1RevenueImpact: "0", q4RevenueImpact: "0", rationale: "x" },
        { tier: "aggressive", pricePoint: "$0", attachRateBySegment: { all: "0%" }, q1RevenueImpact: "0", q4RevenueImpact: "0", rationale: "x" },
      ],
      recommendation: "x",
    };
    await produceGtm(ctx(tmp, mockGtm), {
      feature: { id: "f3", name: "F3", problem: "p", solution: "s" },
      pricing,
      scores: [
        { personaId: "x", usefulness: 5, willingnessToPay: "x", frictionPoints: ["x"], wouldRecommend: true, rationale: "x" },
      ],
    });

    const verdicts = ["kill", "concern"];
    let i = 0;
    const mockCritic = new MockLlmClient(() => {
      const v = verdicts[i++ % verdicts.length];
      return `\`\`\`json\n{"dimension":"d","verdict":"${v}","argument":"a"}\n\`\`\``;
    });

    const out = await adversarialReview(ctx(tmp, mockCritic), {
      featureId: "f3",
      dimensions: ["market-fit", "technical-feasibility"],
    });

    expect(out.plan.adversarialReview.status).toBe("killed");
  });
});
