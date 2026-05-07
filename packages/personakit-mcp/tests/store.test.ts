import { mkdtempSync, rmSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SandboxError, Store } from "../src/store/index.js";

describe("Store sandbox", () => {
  let tmp: string;
  let store: Store;

  beforeEach(async () => {
    tmp = mkdtempSync(path.join(os.tmpdir(), "personakit-test-"));
    store = new Store({ workspaceRoot: tmp });
    await store.init();
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("creates the .personakit/ root and standard subdirs", async () => {
    expect(store.root).toBe(path.resolve(tmp, ".personakit"));
    // exists() smoke-test against expected subdirs
    for (const sub of [
      "personas",
      "research",
      "transcripts",
      "feedback",
      "gtm",
      "audit",
      "agents",
    ] as const) {
      // resolving the subdir with no extras must not throw
      expect(() => store.resolve(sub)).not.toThrow();
    }
  });

  it("rejects writes that escape the sandbox via ../", () => {
    expect(() => store.resolve("personas", "../../etc/passwd")).toThrow(SandboxError);
  });

  it("rejects writes via absolute path that escapes the sandbox", () => {
    // On Windows, an absolute path with a different drive letter escapes.
    // path.resolve will replace the base, so this must be caught.
    const escapeTarget =
      process.platform === "win32" ? "C:\\Windows\\System32\\evil.txt" : "/etc/evil";
    expect(() => store.resolve("personas", escapeTarget)).toThrow(SandboxError);
  });

  it("allows nested paths inside the sandbox", async () => {
    const p = await store.writeText("research", "topic-a/file.md", "hello");
    expect(p.startsWith(store.root)).toBe(true);
    expect(await store.readText("research", "topic-a/file.md")).toBe("hello");
  });

  it("appends to a file without truncating", async () => {
    await store.appendText("audit", "log.jsonl", "line1\n");
    await store.appendText("audit", "log.jsonl", "line2\n");
    expect(await store.readText("audit", "log.jsonl")).toBe("line1\nline2\n");
  });

  it("list returns [] when subdir is empty", async () => {
    expect(await store.list("personas")).toEqual([]);
  });
});
