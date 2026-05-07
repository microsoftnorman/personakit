/**
 * Append-only audit log. One JSONL line per MCP tool invocation.
 *
 * Per the blog's "Do This Safely" section: "Log everything. Every agent
 * decision, every synthetic test result, every filtering rationale, every
 * go-to-market assumption."
 *
 * The log lives at `.personakit/audit/YYYY-MM-DD.jsonl`. Sensitive-looking
 * values in the payload are scrubbed before write.
 */
import type { Store } from "./store/index.js";

export interface AuditEntry {
  ts: string;
  tool: string;
  inputs: unknown;
  outputs: unknown;
  rationale?: string;
  error?: string;
  durationMs?: number;
}

const SECRETLIKE = /(token|api[_-]?key|secret|password|authorization|bearer)/i;

/** Recursively scrub object values whose keys look like secrets. */
function scrub(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[TRUNCATED]";
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    // Long token-looking strings.
    if (value.length > 32 && /^[A-Za-z0-9_-]+$/.test(value)) {
      return "[REDACTED_TOKEN_LIKE]";
    }
    return value;
  }
  if (Array.isArray(value)) return value.map((v) => scrub(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRETLIKE.test(k) ? "[REDACTED]" : scrub(v, depth + 1);
    }
    return out;
  }
  return value;
}

export class Audit {
  constructor(private readonly store: Store) {}

  private fileName(): string {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}.jsonl`;
  }

  async record(entry: Omit<AuditEntry, "ts">): Promise<void> {
    const full: AuditEntry = {
      ts: new Date().toISOString(),
      ...entry,
      inputs: scrub(entry.inputs),
      outputs: scrub(entry.outputs),
    };
    await this.store.appendText("audit", this.fileName(), JSON.stringify(full) + "\n");
  }
}
