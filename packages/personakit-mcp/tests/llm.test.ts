import { describe, expect, it, vi } from "vitest";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  createLlmClientForServer,
  GithubModelsClient,
  HostSamplingClient,
  LazyLlmClient,
  LlmError,
} from "../src/llm/client.js";

/**
 * Build a minimal Server stub that satisfies what the LLM client touches
 * (`getClientCapabilities` and `createMessage`). Cast to `Server` so the
 * factory accepts it.
 */
function makeServerStub(opts: {
  capabilities?: { sampling?: Record<string, unknown> } | undefined;
  createMessage?: ReturnType<typeof vi.fn>;
}): Server {
  return {
    getClientCapabilities: () => opts.capabilities,
    createMessage: opts.createMessage ?? vi.fn(),
  } as unknown as Server;
}

describe("createLlmClientForServer", () => {
  it("returns a HostSamplingClient when the host advertises sampling", async () => {
    const createMessage = vi.fn().mockResolvedValue({
      content: { type: "text", text: "hi from host" },
    });
    const server = makeServerStub({
      capabilities: { sampling: {} },
      createMessage,
    });

    const llm = createLlmClientForServer(server, {} as NodeJS.ProcessEnv);
    // First call resolves the lazy wrapper.
    const reply = await llm.complete({ messages: [{ role: "user", content: "hello" }] });

    expect(llm.provider).toBe("host-sampling");
    expect(reply).toBe("hi from host");
    expect(createMessage).toHaveBeenCalledTimes(1);
  });

  it("falls back to GithubModelsClient when no sampling but a token is set", () => {
    const server = makeServerStub({ capabilities: undefined });
    const llm = createLlmClientForServer(server, {
      GITHUB_MODELS_TOKEN: "tok",
    } as NodeJS.ProcessEnv);

    // Touch a property to force lazy resolution without making a network call.
    expect(llm.provider).toBe("github-models");
  });

  it("throws when neither sampling nor a token is available", () => {
    const server = makeServerStub({ capabilities: undefined });
    const llm = createLlmClientForServer(server, {} as NodeJS.ProcessEnv);
    expect(() => llm.provider).toThrow(LlmError);
  });

  it("PERSONAKIT_FORCE_ENV_LLM=1 bypasses sampling even when offered", () => {
    const server = makeServerStub({ capabilities: { sampling: {} } });
    const llm = createLlmClientForServer(server, {
      PERSONAKIT_FORCE_ENV_LLM: "1",
      GITHUB_MODELS_TOKEN: "tok",
    } as NodeJS.ProcessEnv);
    expect(llm.provider).toBe("github-models");
  });
});

describe("HostSamplingClient.complete", () => {
  it("joins system messages into systemPrompt and forwards user/assistant turns", async () => {
    const createMessage = vi.fn().mockResolvedValue({
      content: { type: "text", text: "ack" },
    });
    const client = new HostSamplingClient(
      makeServerStub({ capabilities: { sampling: {} }, createMessage }),
    );

    await client.complete({
      messages: [
        { role: "system", content: "You are Maya." },
        { role: "system", content: "Stay terse." },
        { role: "user", content: "Hi" },
        { role: "assistant", content: "Hello" },
        { role: "user", content: "Continue" },
      ],
      maxTokens: 256,
      temperature: 0.3,
    });

    expect(createMessage).toHaveBeenCalledOnce();
    const params = createMessage.mock.calls[0]![0] as {
      systemPrompt?: string;
      messages: Array<{ role: string; content: { type: string; text: string } }>;
      maxTokens?: number;
      temperature?: number;
    };
    expect(params.systemPrompt).toBe("You are Maya.\n\nStay terse.");
    expect(params.maxTokens).toBe(256);
    expect(params.temperature).toBe(0.3);
    expect(params.messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(params.messages[0]!.content).toEqual({ type: "text", text: "Hi" });
  });

  it("concatenates multi-block text array responses", async () => {
    const createMessage = vi.fn().mockResolvedValue({
      content: [
        { type: "text", text: "part one" },
        { type: "text", text: "part two" },
      ],
    });
    const client = new HostSamplingClient(
      makeServerStub({ capabilities: { sampling: {} }, createMessage }),
    );
    const reply = await client.complete({
      messages: [{ role: "user", content: "?" }],
    });
    expect(reply).toBe("part one\npart two");
  });

  it("throws LlmError on non-text content", async () => {
    const createMessage = vi.fn().mockResolvedValue({
      content: { type: "image", data: "...", mimeType: "image/png" },
    });
    const client = new HostSamplingClient(
      makeServerStub({ capabilities: { sampling: {} }, createMessage }),
    );
    await expect(
      client.complete({ messages: [{ role: "user", content: "?" }] }),
    ).rejects.toBeInstanceOf(LlmError);
  });

  it("omits systemPrompt when no system messages are present", async () => {
    const createMessage = vi.fn().mockResolvedValue({
      content: { type: "text", text: "ok" },
    });
    const client = new HostSamplingClient(
      makeServerStub({ capabilities: { sampling: {} }, createMessage }),
    );
    await client.complete({ messages: [{ role: "user", content: "hi" }] });
    const params = createMessage.mock.calls[0]![0] as { systemPrompt?: string };
    expect(params.systemPrompt).toBeUndefined();
  });
});

describe("LazyLlmClient", () => {
  it("does not invoke the resolver until the first property/method access", () => {
    const resolve = vi.fn().mockReturnValue(new GithubModelsClient("tok", "m"));
    const lazy = new LazyLlmClient(resolve);
    expect(resolve).not.toHaveBeenCalled();
    expect(lazy.resolved).toBe(false);

    void lazy.provider;
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(lazy.resolved).toBe(true);

    void lazy.model;
    void lazy.provider;
    expect(resolve).toHaveBeenCalledTimes(1); // memoised
  });
});
