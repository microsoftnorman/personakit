/**
 * GitHub-Copilot-only LLM client.
 *
 * Personakit is designed to run inside a GitHub Copilot host (Copilot Chat,
 * Copilot CLI, or any Copilot-compatible MCP host) and uses GitHub-hosted
 * models exclusively. No third-party LLM providers are supported by design —
 * the goal is to reuse the same auth your Copilot host already has.
 *
 * Credentials are auto-detected from the environment in this order:
 *   1. GITHUB_MODELS_TOKEN  (preferred — explicit, scoped to GitHub Models)
 *   2. GH_TOKEN             (Copilot CLI sets this for the active session)
 *   3. GITHUB_TOKEN         (broader fallback, also accepted by Copilot CLI)
 *
 * The client is intentionally small — no vendor SDK — so the MCP server stays
 * trim. Requests go to GitHub Models via `fetch`.
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

/**
 * Auto-detect a GitHub Copilot credential from the environment.
 *
 * Personakit only supports GitHub-hosted models. If you need a different
 * provider, that is a fork — not a configuration option.
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
    "No GitHub credential found. Personakit only works with GitHub Copilot — set GITHUB_MODELS_TOKEN (preferred), or GH_TOKEN / GITHUB_TOKEN.",
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
