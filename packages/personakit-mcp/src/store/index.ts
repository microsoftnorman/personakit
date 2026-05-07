/**
 * Filesystem store rooted at <workspace>/.personakit/.
 * All writes go through here; the sandbox guard rejects paths that escape root.
 */
import { promises as fs } from "node:fs";
import * as path from "node:path";

export interface StoreOptions {
  /** Workspace root. The sandbox is `<workspaceRoot>/.personakit`. */
  workspaceRoot: string;
}

const SUBDIRS = [
  "personas",
  "research",
  "transcripts",
  "feedback",
  "gtm",
  "audit",
  "agents",
] as const;

export type Subdir = (typeof SUBDIRS)[number];

export class SandboxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SandboxError";
  }
}

export class Store {
  readonly root: string;

  constructor(opts: StoreOptions) {
    this.root = path.resolve(opts.workspaceRoot, ".personakit");
  }

  /** Create the sandbox and all standard subdirectories. Idempotent. */
  async init(): Promise<void> {
    await fs.mkdir(this.root, { recursive: true });
    for (const sub of SUBDIRS) {
      await fs.mkdir(path.join(this.root, sub), { recursive: true });
    }
  }

  /**
   * Resolve a path inside the sandbox. Throws SandboxError if the resolved
   * path escapes the root (path traversal guard).
   */
  resolve(subdir: Subdir, ...parts: string[]): string {
    const candidate = path.resolve(this.root, subdir, ...parts);
    const rootWithSep = this.root.endsWith(path.sep)
      ? this.root
      : this.root + path.sep;
    if (candidate !== this.root && !candidate.startsWith(rootWithSep)) {
      throw new SandboxError(
        `Refusing to write outside .personakit/ sandbox: ${candidate}`,
      );
    }
    return candidate;
  }

  async writeText(
    subdir: Subdir,
    relPath: string,
    content: string,
  ): Promise<string> {
    const full = this.resolve(subdir, relPath);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, content, "utf8");
    return full;
  }

  async writeJson(
    subdir: Subdir,
    relPath: string,
    value: unknown,
  ): Promise<string> {
    return this.writeText(subdir, relPath, JSON.stringify(value, null, 2) + "\n");
  }

  async appendText(
    subdir: Subdir,
    relPath: string,
    content: string,
  ): Promise<string> {
    const full = this.resolve(subdir, relPath);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.appendFile(full, content, "utf8");
    return full;
  }

  async readText(subdir: Subdir, relPath: string): Promise<string> {
    const full = this.resolve(subdir, relPath);
    return fs.readFile(full, "utf8");
  }

  async readJson<T>(subdir: Subdir, relPath: string): Promise<T> {
    return JSON.parse(await this.readText(subdir, relPath)) as T;
  }

  async list(subdir: Subdir): Promise<string[]> {
    const dir = this.resolve(subdir);
    try {
      return await fs.readdir(dir);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
  }

  async exists(subdir: Subdir, relPath: string): Promise<boolean> {
    try {
      await fs.access(this.resolve(subdir, relPath));
      return true;
    } catch {
      return false;
    }
  }
}
