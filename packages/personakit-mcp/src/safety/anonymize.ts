/**
 * PII anonymization for ingested research documents.
 *
 * Personakit treats every ingested document as potentially containing PII.
 * Per the blog's "Do This Safely": "Ground synthetic personas in real data,
 * but anonymize them. The personas should reflect real behavioral patterns.
 * They should never contain real PII."
 *
 * This module redacts common PII patterns BEFORE the content is stored or
 * sent to an LLM. It is intentionally conservative — false positives are
 * preferable to leaks. It is not a substitute for legal/compliance review.
 */

export interface AnonymizeResult {
  text: string;
  redactions: Redaction[];
}

export interface Redaction {
  kind:
    | "email"
    | "phone"
    | "ssn"
    | "credit-card"
    | "ip"
    | "url-with-token"
    | "name"
    | "street-address"
    | "secret-like";
  count: number;
}

const PATTERNS: Array<{
  kind: Redaction["kind"];
  re: RegExp;
  replacement: string;
}> = [
  {
    kind: "email",
    re: /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi,
    replacement: "[REDACTED_EMAIL]",
  },
  {
    // North-American style phone numbers; conservative.
    kind: "phone",
    re: /(?:\+?\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g,
    replacement: "[REDACTED_PHONE]",
  },
  {
    kind: "ssn",
    re: /\b\d{3}-\d{2}-\d{4}\b/g,
    replacement: "[REDACTED_SSN]",
  },
  {
    // Naive 13-19 digit groups — credit-card-like; conservative.
    kind: "credit-card",
    re: /\b(?:\d[ -]?){13,19}\b/g,
    replacement: "[REDACTED_CARD]",
  },
  {
    kind: "ip",
    re: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
    replacement: "[REDACTED_IP]",
  },
  {
    // URL with what looks like a token in the query string or path.
    kind: "url-with-token",
    re: /https?:\/\/\S*?(?:token|key|secret|api[-_]?key|access[-_]?token)=\S+/gi,
    replacement: "[REDACTED_URL]",
  },
  {
    // Bearer-style or long high-entropy token-looking strings.
    kind: "secret-like",
    re: /\b(?:sk|pk|ghp|gho|ghu|ghs|ghr|xox[bpoa])[-_][A-Za-z0-9_-]{16,}\b/g,
    replacement: "[REDACTED_SECRET]",
  },
  {
    // Street-address heuristic: "<number> <Word> <Street|St|Ave|Rd|Blvd|...>"
    kind: "street-address",
    re: /\b\d{1,5}\s+[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?\s+(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr|Court|Ct|Way|Place|Pl)\b\.?/g,
    replacement: "[REDACTED_ADDRESS]",
  },
  {
    // Two-or-three capitalized words preceded by a "name marker".
    // Conservative to avoid mangling product/company names.
    kind: "name",
    re: /\b(?:Mr\.|Mrs\.|Ms\.|Dr\.|Prof\.|CEO|CFO|CTO|COO|VP|Director|Manager|contact:|signed by|interviewed:?)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})\b/g,
    replacement: (_match: string, _name: string) => "Mr./Ms. [REDACTED_NAME]",
  } as unknown as { kind: Redaction["kind"]; re: RegExp; replacement: string },
];

/**
 * Run all redactors over `input` and return both the cleaned text and a
 * count of redactions per kind.
 */
export function anonymize(input: string): AnonymizeResult {
  let text = input;
  const counts = new Map<Redaction["kind"], number>();

  for (const pat of PATTERNS) {
    let n = 0;
    text = text.replace(
      pat.re,
      (...args: unknown[]): string => {
        n++;
        // Replacement may be string or function.
        const replacement = pat.replacement as
          | string
          | ((...a: unknown[]) => string);
        return typeof replacement === "function"
          ? replacement(...args)
          : replacement;
      },
    );
    if (n > 0) counts.set(pat.kind, (counts.get(pat.kind) ?? 0) + n);
  }

  const redactions: Redaction[] = [...counts.entries()].map(([kind, count]) => ({
    kind,
    count,
  }));
  return { text, redactions };
}

/**
 * Sanity-check helper: does the given text *look* like it still contains PII?
 * Used as a defence-in-depth check before persisting persona dossiers.
 */
export function looksAnonymized(text: string): boolean {
  const result = anonymize(text);
  return result.redactions.length === 0;
}
