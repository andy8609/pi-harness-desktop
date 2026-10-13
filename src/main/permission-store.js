import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
/**
 * Remembers permission decisions.
 *
 * - `session` rules live in memory and reset when the session changes.
 * - `always` rules persist to `~/.pi/agent/desktop-permissions.json`.
 */
export class PermissionStore {
    sessionAllowed = new Set();
    alwaysAllowed;
    path;
    constructor(path = join(getAgentDir(), "desktop-permissions.json")) {
        this.path = path;
        this.alwaysAllowed = this.load();
    }
    load() {
        try {
            if (!existsSync(this.path))
                return new Set();
            const parsed = JSON.parse(readFileSync(this.path, "utf8"));
            const list = Array.isArray(parsed.always) ? parsed.always : [];
            return new Set(list.filter((value) => typeof value === "string" && value.length > 0));
        }
        catch {
            return new Set();
        }
    }
    persist() {
        try {
            mkdirSync(dirname(this.path), { recursive: true });
            writeFileSync(this.path, `${JSON.stringify({ always: [...this.alwaysAllowed].sort() }, null, 2)}\n`, "utf8");
        }
        catch {
            // Persistence failure must never block tool execution.
        }
    }
    isAllowed(key) {
        return this.sessionAllowed.has(key) || this.alwaysAllowed.has(key);
    }
    allowSession(key) {
        this.sessionAllowed.add(key);
    }
    allowAlways(key) {
        this.alwaysAllowed.add(key);
        this.persist();
    }
    forgetAlways(key) {
        this.alwaysAllowed.delete(key);
        this.persist();
    }
    clearAlways() {
        this.alwaysAllowed.clear();
        this.persist();
    }
    clearSession() {
        this.sessionAllowed.clear();
    }
    listAlways() {
        return [...this.alwaysAllowed].sort();
    }
}
