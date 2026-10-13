/**
 * Risk classification for shell commands and filesystem paths.
 *
 * Ported from workagent's `packages/tool-runtime/src/sandbox-policy.ts`.
 * Kept as pure functions so the policy can be unit-tested without Electron.
 */
export type ShellRiskKind = "outbound" | "git_mutation" | "destructive" | "routine";
export declare function classifyShellRisk(command: string): ShellRiskKind;
export declare function shellRiskLabel(risk: ShellRiskKind): string;
/**
 * Whether a path names a credential/secret file the agent must not touch.
 * Normalizes separators so it behaves the same on Windows and POSIX.
 */
export declare function isSecretPath(target: string): boolean;
