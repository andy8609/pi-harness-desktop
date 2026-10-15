import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

interface PermissionFile {
  always?: string[];
  fullTrustCwds?: string[];
}

function normalizeCwd(cwd: string): string {
  return resolve(cwd).replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

/**
 * Remembers permission decisions.
 *
 * - `session` rules live in memory and reset when the session changes.
 * - `always` rules persist to `~/.pi/agent/desktop-permissions.json`.
 * - `fullTrust` per project skips risk prompts (secret files stay blocked).
 */
export class PermissionStore {
  private readonly sessionAllowed = new Set<string>();
  private readonly alwaysAllowed: Set<string>;
  private readonly fullTrustCwds: Set<string>;
  private readonly path: string;

  constructor(path = join(getAgentDir(), "desktop-permissions.json")) {
    this.path = path;
    const loaded = this.load();
    this.alwaysAllowed = loaded.always;
    this.fullTrustCwds = loaded.fullTrust;
  }

  private load(): { always: Set<string>; fullTrust: Set<string> } {
    try {
      if (!existsSync(this.path)) return { always: new Set(), fullTrust: new Set() };
      const parsed = JSON.parse(readFileSync(this.path, "utf8")) as PermissionFile;
      const always = Array.isArray(parsed.always) ? parsed.always : [];
      const fullTrust = Array.isArray(parsed.fullTrustCwds) ? parsed.fullTrustCwds : [];
      return {
        always: new Set(always.filter((value): value is string => typeof value === "string" && value.length > 0)),
        fullTrust: new Set(
          fullTrust
            .filter((value): value is string => typeof value === "string" && value.length > 0)
            .map(normalizeCwd),
        ),
      };
    } catch {
      return { always: new Set(), fullTrust: new Set() };
    }
  }

  private persist(): void {
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      writeFileSync(
        this.path,
        `${JSON.stringify(
          {
            always: [...this.alwaysAllowed].sort(),
            fullTrustCwds: [...this.fullTrustCwds].sort(),
          },
          null,
          2,
        )}\n`,
      );
    } catch {
      // Persistence failure must never block tool execution.
    }
  }

  isAllowed(key: string): boolean {
    return this.sessionAllowed.has(key) || this.alwaysAllowed.has(key);
  }

  isFullTrust(cwd: string): boolean {
    if (!cwd) return false;
    return this.fullTrustCwds.has(normalizeCwd(cwd));
  }

  setFullTrust(cwd: string, enabled: boolean): void {
    if (!cwd) return;
    const key = normalizeCwd(cwd);
    if (enabled) this.fullTrustCwds.add(key);
    else this.fullTrustCwds.delete(key);
    this.persist();
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
