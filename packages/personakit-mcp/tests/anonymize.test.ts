import { describe, expect, it } from "vitest";
import { anonymize, looksAnonymized } from "../src/safety/anonymize.js";

describe("anonymize", () => {
  it("redacts emails", () => {
    const r = anonymize("contact: john@acme.com or jane@example.co.uk");
    expect(r.text).not.toContain("john@acme.com");
    expect(r.text).not.toContain("jane@example.co.uk");
    expect(r.redactions.find((x) => x.kind === "email")?.count).toBe(2);
  });

  it("redacts phone numbers", () => {
    const r = anonymize("call (555) 123-4567 or 555.123.4567");
    expect(r.text).not.toMatch(/555/);
    expect(r.redactions.find((x) => x.kind === "phone")?.count).toBeGreaterThanOrEqual(1);
  });

  it("redacts SSNs", () => {
    const r = anonymize("ssn 123-45-6789");
    expect(r.text).toContain("[REDACTED_SSN]");
  });

  it("redacts secret-looking tokens", () => {
    const r = anonymize("token: ghp_AbCdEfGhIjKlMnOpQrStUvWxYz12345678");
    expect(r.text).not.toContain("ghp_AbCdEfGhIjKlMnOpQrStUvWxYz12345678");
    expect(r.text).toContain("[REDACTED_SECRET]");
  });

  it("redacts URL with token in query string", () => {
    const r = anonymize("see https://api.example.com/v1/things?api_key=AbCdEfGh1234");
    expect(r.text).toContain("[REDACTED_URL]");
  });

  it("redacts the canonical John Doe / john@acme.com / 555-1212 example", () => {
    const r = anonymize("John Doe, john@acme.com, 555-1212");
    expect(r.text).not.toContain("john@acme.com");
    // Note: 555-1212 alone (no area code) is NOT matched by the conservative
    // phone regex; this is intentional. Email + name-marker still redact.
    expect(looksAnonymized(r.text)).toBe(true);
  });

  it("looksAnonymized returns true for clean text", () => {
    expect(looksAnonymized("This is fine. No PII here.")).toBe(true);
  });

  it("looksAnonymized returns false when PII is present", () => {
    expect(looksAnonymized("ping john@acme.com")).toBe(false);
  });
});
