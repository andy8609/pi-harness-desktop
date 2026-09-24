import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

interface PermissionFile {
  always?: string[];
}

/**
 * Remembers permission decisions.
 *
 * - `session` rules live in memory and reset when the session changes.
 * - `always` rules persist to `~/.pi/agent/desktop-permissions.json`.
 */
export class PermissionStore {
  private readonly sessionAllowed = new Set<string>();
  private readonly alwaysAllowed: Set<string>;
  private readonly path: string;

  constructor(path = join(getAgentDir(), "desktop-permissions.json")) {
    this.path = path;
    this.alwaysAllowed = this.load();
  }

  private load(): Set<string> {
    try {
      if (!existsSync(this.path)) return new Set();
      const parsed = JSON.parse(readFileSync(this.path, "utf8")) as PermissionFile;
      const list = Array.isArray(parsed.always) ? parsed.always : [];
      return new Set(list.filter((value): value is string => typeof value === "string" && value.length > 0));
    } catch {
      return new Set();
    }
  }

  private persist(): void {
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      writeFileSync(
        this.path,
        `${JSON.stringify({ always: [...this.alwaysAllowed].sort() }, null, 2)}\n`,
        "utf8",
      );
    } catch {
      // Persistence failure must never block tool execution.
    }
  }

  isAllowed(key: string): boolean {
    return this.sessionAllowed.has(key) || this.alwaysAllowed.has(key);
  }

  allowSession(key: string): void {
    this.sessionAllowed.add(key);
  }

  allowAlways(key: string): void {
    this.alwaysAllowed.add(key);
    this.persist();
  }

  forgetAlways(key: string): void {
    this.alwaysAllowed.delete(key);
    this.persist();
  }

  clearAlways(): void {
    this.alwaysAllowed.clear();
    this.persist();
  }

  clearSession(): void {
    this.sessionAllowed.clear();
  }

  listAlways(): string[] {
    return [...this.alwaysAllowed].sort();
  }
}
