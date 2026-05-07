/**
 * Shared context passed to every tool: the store, the LLM client, and the audit log.
 */
import type { LlmClient } from "./llm/client.js";
import type { Store } from "./store/index.js";
import type { Audit } from "./audit.js";

export interface ToolContext {
  store: Store;
  llm: LlmClient;
  audit: Audit;
  /** Optional fetch override for testing the research tool. */
  fetchImpl?: typeof fetch;
}

/** Best-effort JSON extractor: pulls the first ```json ... ``` block, else parses raw. */
export function extractJson<T = unknown>(text: string): T {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fence?.[1]?.trim() ?? text.trim();
  try {
    return JSON.parse(candidate) as T;
  } catch {
    // Try to recover by trimming to first {...} or [...] block.
    const objMatch = candidate.match(/\{[\s\S]*\}/);
    const arrMatch = candidate.match(/\[[\s\S]*\]/);
    const sub = objMatch?.[0] ?? arrMatch?.[0];
    if (sub) return JSON.parse(sub) as T;
    throw new Error(`LLM did not return valid JSON. Got: ${text.slice(0, 200)}…`);
  }
}

/** Slugify a free-text label for use as a filename. */
export function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "item";
}

/** Stable session id (date + random). */
export function newSessionId(prefix = "s"): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${stamp}-${rand}`;
}
