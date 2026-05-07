import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Audit } from "../src/audit.js";
import { Store } from "../src/store/index.js";

describe("Audit", () => {
  let tmp: string;
  let store: Store;
  let audit: Audit;

  beforeEach(async () => {
    tmp = mkdtempSync(path.join(os.tmpdir(), "personakit-audit-"));
    store = new Store({ workspaceRoot: tmp });
    await store.init();
    audit = new Audit(store);
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("appends one JSONL line per record", async () => {
    await audit.record({ tool: "t1", inputs: { a: 1 }, outputs: { ok: true } });
    await audit.record({ tool: "t2", inputs: { b: 2 }, outputs: { ok: true } });

    const files = await store.list("audit");
    expect(files).toHaveLength(1);
    const content = readFileSync(path.join(store.root, "audit", files[0]!), "utf8");
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(2);
    const parsed = lines.map((l) => JSON.parse(l));
    expect(parsed[0].tool).toBe("t1");
    expect(parsed[1].tool).toBe("t2");
  });

  it("redacts secret-shaped keys", async () => {
    await audit.record({
      tool: "x",
      inputs: { api_key: "abc", token: "xyz", normal: "fine" },
      outputs: null,
    });
    const files = await store.list("audit");
    const content = readFileSync(path.join(store.root, "audit", files[0]!), "utf8");
    const entry = JSON.parse(content.trim());
    expect(entry.inputs.api_key).toBe("[REDACTED]");
    expect(entry.inputs.token).toBe("[REDACTED]");
    expect(entry.inputs.normal).toBe("fine");
  });

  it("redacts long token-shaped values", async () => {
    await audit.record({
      tool: "x",
      inputs: { value: "a".repeat(40) },
      outputs: null,
    });
    const files = await store.list("audit");
    const content = readFileSync(path.join(store.root, "audit", files[0]!), "utf8");
    const entry = JSON.parse(content.trim());
    expect(entry.inputs.value).toBe("[REDACTED_TOKEN_LIKE]");
  });
});
