/**
 * Thin wrapper around `zod-to-json-schema` so callers don't have to know the
 * package's exact API and so we can swap it out later if needed.
 */
import { zodToJsonSchema as convert } from "zod-to-json-schema";
import type { ZodTypeAny } from "zod";

export function zodToJsonSchema(schema: ZodTypeAny): Record<string, unknown> {
  // `target: "openApi3"` produces simpler output that MCP hosts handle well.
  return convert(schema, { target: "openApi3", $refStrategy: "none" }) as Record<
    string,
    unknown
  >;
}
