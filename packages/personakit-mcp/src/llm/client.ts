/**
 * LLM client for personakit-mcp.
 *
 * Personakit prefers running inside an MCP host that supports **sampling**
 * (e.g. VS Code + GitHub Copilot Chat). When the host advertises the
 * `sampling` capability, we delegate every LLM call to it via
 * `server.createMessage(...)` and reuse whatever model the user already has
 * authenticated with their Copilot host — no token or env var required.
 *
 * When sampling is unavailable (e.g. running standalone, or via a host like
 * Copilot CLI that doesn't proxy sampling), we fall back to a direct
 * GitHub Models call using a token from the environment, in this order:
 *   1. GITHUB_MODELS_TOKEN  (preferred — explicit, scoped to GitHub Models)
 *   2. GH_TOKEN             (Copilot CLI sets this for the active session)
 *   3. GITHUB_TOKEN         (broader fallback)
 *
 * For tests, inject a `MockLlmClient` instead.
 */
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";

export interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LlmCompleteOptions {
  /** Conversation messages, in order. */
  messages: LlmMessage[];
  /** Optional max tokens for the response. */
  maxTokens?: number;
  /** Optional sampling temperature (0..2). */
  temperature?: number;
  /** Logical purpose, used for audit log only. */
  purpose?: string;
}

export interface LlmClient {
  /** Identifier of the active provider, e.g. "github-models", "host-sampling", "mock". */
  readonly provider: string;
  /** Model name (provider-specific). */
  readonly model: string;
  complete(opts: LlmCompleteOptions): Promise<string>;
}

export class LlmError extends Error {
  constructor(
    message: string,
    readonly provider: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "LlmError";
  }
}

/**
 * Auto-detect a GitHub Copilot credential from the environment.
 *
 * Used as a fallback when MCP host sampling is not available.
 */
export function createLlmClientFromEnv(env: NodeJS.ProcessEnv): LlmClient {
  const token =
    env.GITHUB_MODELS_TOKEN ?? env.GH_TOKEN ?? env.GITHUB_TOKEN;
  if (token) {
    return new GithubModelsClient(
      token,
      env.PERSONAKIT_MODEL ?? "gpt-4o-mini",
    );
  }
  throw new LlmError(
    "No LLM available. Run inside an MCP host with sampling support (e.g. VS Code + Copilot Chat), or set GITHUB_MODELS_TOKEN / GH_TOKEN / GITHUB_TOKEN.",
    "none",
  );
}

/**
 * Pick the best available LLM client. Prefers MCP host sampling (no token
 * required); falls back to env-token GitHub Models. Resolution is deferred
 * until first use so we can inspect client capabilities after the MCP
 * handshake completes.
 *
 * Set `PERSONAKIT_FORCE_ENV_LLM=1` to bypass sampling and force the env-token
 * path (useful for testing the fallback).
 */
export function createLlmClientForServer(
  server: Server,
  env: NodeJS.ProcessEnv,
): LlmClient {
  return new LazyLlmClient(() => {
    if (env.PERSONAKIT_FORCE_ENV_LLM !== "1") {
      const caps = server.getClientCapabilities();
      if (caps?.sampling) {
        return new HostSamplingClient(server, env.PERSONAKIT_MODEL);
      }
    }
    return createLlmClientFromEnv(env);
  });
}

abstract class HttpJsonClient {
  protected async post<T>(
    url: string,
    headers: Record<string, string>,
    body: unknown,
    provider: string,
  ): Promise<T> {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new LlmError(
        `${provider} returned HTTP ${res.status}: ${text.slice(0, 500)}`,
        provider,
        res.status,
      );
    }
    return (await res.json()) as T;
  }
}

/** Shape of the chat-completions response returned by GitHub Models. */
interface ChatCompletionsResponse {
  choices: Array<{ message: { content: string } }>;
}

export class GithubModelsClient extends HttpJsonClient implements LlmClient {
  readonly provider = "github-models";
  constructor(
    private readonly token: string,
    readonly model: string,
  ) {
    super();
  }
  async complete(opts: LlmCompleteOptions): Promise<string> {
    const data = await this.post<ChatCompletionsResponse>(
      "https://models.inference.ai.azure.com/chat/completions",
      { authorization: `Bearer ${this.token}` },
      {
        model: this.model,
        messages: opts.messages,
        max_tokens: opts.maxTokens ?? 1500,
        temperature: opts.temperature ?? 0.7,
      },
      this.provider,
    );
    return data.choices[0]?.message?.content ?? "";
  }
}

/**
 * Delegates LLM calls to the MCP host via `sampling/createMessage`. The host
 * (e.g. VS Code + Copilot Chat) chooses the model and supplies auth, so the
 * server itself never sees a token. This is the preferred path for end users
 * — installation requires no env var setup at all.
 */
export class HostSamplingClient implements LlmClient {
  readonly provider = "host-sampling";
  readonly model: string;
  constructor(
    private readonly server: Pick<Server, "createMessage">,
    modelHint?: string,
  ) {
    // The host picks the actual model; this string is informational only
    // (used for the audit log and tool output metadata).
    this.model = modelHint ?? "host-selected";
  }
  async complete(opts: LlmCompleteOptions): Promise<string> {
    const systemMsgs = opts.messages.filter((m) => m.role === "system");
    const turn = opts.messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role as "user" | "assistant",
        content: { type: "text" as const, text: m.content },
      }));

    const result = await this.server.createMessage({
      messages: turn,
      systemPrompt:
        systemMsgs.map((m) => m.content).join("\n\n") || undefined,
      maxTokens: opts.maxTokens ?? 1500,
      temperature: opts.temperature ?? 0.7,
    });

    return extractText(result.content, this.provider);
  }
}

function extractText(
  content: unknown,
  provider: string,
): string {
  // Spec: single block { type, text } | { type: 'image', ... } | array of blocks.
  if (Array.isArray(content)) {
    const parts = content
      .filter((b): b is { type: "text"; text: string } =>
        !!b && typeof b === "object" && (b as { type?: string }).type === "text",
      )
      .map((b) => b.text);
    if (parts.length === 0) {
      throw new LlmError(
        `${provider} returned no text content blocks: ${JSON.stringify(content).slice(0, 200)}`,
        provider,
      );
    }
    return parts.join("\n");
  }
  if (
    content &&
    typeof content === "object" &&
    (content as { type?: string }).type === "text"
  ) {
    return (content as { type: "text"; text: string }).text;
  }
  throw new LlmError(
    `${provider} returned non-text content: ${JSON.stringify(content).slice(0, 200)}`,
    provider,
  );
}

/**
 * Defers actual client creation until first use. Lets us register the MCP
 * server's request handlers (which close over the LLM via ctx) before the
 * client capability handshake has completed.
 */
export class LazyLlmClient implements LlmClient {
  private inner?: LlmClient;
  constructor(private readonly resolve: () => LlmClient) {}
  private get c(): LlmClient {
    return (this.inner ??= this.resolve());
  }
  /** True iff the underlying client has been resolved. */
  get resolved(): boolean {
    return this.inner !== undefined;
  }
  get provider(): string {
    return this.c.provider;
  }
  get model(): string {
    return this.c.model;
  }
  complete(opts: LlmCompleteOptions): Promise<string> {
    return this.c.complete(opts);
  }
}

/**
 * Test/dev mock. Returns canned responses based on a `respond` callback.
 */
export class MockLlmClient implements LlmClient {
  readonly provider = "mock";
  readonly model = "mock-model";
  private calls = 0;
  constructor(
    private readonly respond: (
      opts: LlmCompleteOptions,
      callIndex: number,
    ) => string,
  ) {}
  async complete(opts: LlmCompleteOptions): Promise<string> {
    return this.respond(opts, this.calls++);
  }
  get callCount(): number {
    return this.calls;
  }
}
