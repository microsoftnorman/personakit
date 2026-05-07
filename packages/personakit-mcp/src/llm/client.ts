/**
 * Pluggable LLM client. Auto-detects provider in this order:
 *   1. GITHUB_MODELS_TOKEN (GitHub Models API — recommended for Copilot users)
 *   2. OPENAI_API_KEY     (OpenAI Chat Completions)
 *   3. ANTHROPIC_API_KEY  (Anthropic Messages API)
 *
 * The client is intentionally small. We do not depend on a vendor SDK so the
 * MCP server stays trim. All providers are addressed via `fetch` against
 * documented HTTP APIs.
 *
 * For tests, inject a `MockLlmClient` instead.
 */

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
  /** Identifier of the active provider, e.g. "github-models" or "mock". */
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

/** Auto-detect a provider from environment variables. */
export function createLlmClientFromEnv(env: NodeJS.ProcessEnv): LlmClient {
  if (env.GITHUB_MODELS_TOKEN) {
    return new GithubModelsClient(
      env.GITHUB_MODELS_TOKEN,
      env.PERSONAKIT_MODEL ?? "gpt-4o-mini",
    );
  }
  if (env.OPENAI_API_KEY) {
    return new OpenAiClient(
      env.OPENAI_API_KEY,
      env.PERSONAKIT_MODEL ?? "gpt-4o-mini",
    );
  }
  if (env.ANTHROPIC_API_KEY) {
    return new AnthropicClient(
      env.ANTHROPIC_API_KEY,
      env.PERSONAKIT_MODEL ?? "claude-3-5-haiku-latest",
    );
  }
  throw new LlmError(
    "No LLM credentials found. Set one of: GITHUB_MODELS_TOKEN, OPENAI_API_KEY, ANTHROPIC_API_KEY.",
    "none",
  );
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

interface OpenAiResponse {
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
    const data = await this.post<OpenAiResponse>(
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

export class OpenAiClient extends HttpJsonClient implements LlmClient {
  readonly provider = "openai";
  constructor(
    private readonly token: string,
    readonly model: string,
  ) {
    super();
  }
  async complete(opts: LlmCompleteOptions): Promise<string> {
    const data = await this.post<OpenAiResponse>(
      "https://api.openai.com/v1/chat/completions",
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

interface AnthropicResponse {
  content: Array<{ type: string; text?: string }>;
}

export class AnthropicClient extends HttpJsonClient implements LlmClient {
  readonly provider = "anthropic";
  constructor(
    private readonly token: string,
    readonly model: string,
  ) {
    super();
  }
  async complete(opts: LlmCompleteOptions): Promise<string> {
    // Anthropic separates `system` from the messages list.
    const system = opts.messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n\n");
    const messages = opts.messages
      .filter((m) => m.role !== "system")
      .map((m) => ({ role: m.role, content: m.content }));
    const data = await this.post<AnthropicResponse>(
      "https://api.anthropic.com/v1/messages",
      {
        "x-api-key": this.token,
        "anthropic-version": "2023-06-01",
      },
      {
        model: this.model,
        system,
        messages,
        max_tokens: opts.maxTokens ?? 1500,
        temperature: opts.temperature ?? 0.7,
      },
      this.provider,
    );
    return data.content
      .filter((c) => c.type === "text")
      .map((c) => c.text ?? "")
      .join("");
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
