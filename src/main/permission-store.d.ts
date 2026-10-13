/**
 * Remembers permission decisions.
 *
 * - `session` rules live in memory and reset when the session changes.
 * - `always` rules persist to `~/.pi/agent/desktop-permissions.json`.
 */
export declare class PermissionStore {
    private readonly sessionAllowed;
    private readonly alwaysAllowed;
    private readonly path;
    constructor(path?: string);
    private load;
    private persist;
    isAllowed(key: string): boolean;
    allowSession(key: string): void;
    allowAlways(key: string): void;
    forgetAlways(key: string): void;
    clearAlways(): void;
    clearSession(): void;
    listAlways(): string[];
}
