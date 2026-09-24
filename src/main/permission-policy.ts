import { basename, resolve } from "node:path";

/**
 * Risk classification for shell commands and filesystem paths.
 *
 * Ported from workagent's `packages/tool-runtime/src/sandbox-policy.ts`.
 * Kept as pure functions so the policy can be unit-tested without Electron.
 */

export type ShellRiskKind = "outbound" | "git_mutation" | "destructive" | "routine";

const OUTBOUND_SHELL_PATTERN =
  /\b(?:curl|wget|Invoke-WebRequest|Invoke-RestMethod|\biwr\b|\bssh\b|\bscp\b|\bsftp\b|ftp\b|npm\s+(?:i|install|ci|publish|add)\b|pnpm\s+(?:i|install|add|publish)\b|yarn\s+(?:add|publish)\b|pip(?:3)?\s+install\b)\b/i;

const GIT_MUTATION_SHELL_PATTERN =
  /\bgit(?:\s+--?[A-Za-z][\w-]*(?:[=\s]+[^\s;&|]+)?)*\s+(?:add|restore|reset|clean|commit|push|pull|fetch|merge(?!-base\b)|rebase|cherry-pick|worktree)\b/i;

const DESTRUCTIVE_SHELL_PATTERN =
  /\b(?:rm\s+-[a-zA-Z]*r[a-zA-Z]*f\b|rmdir\s+\/s\b|Remove-Item\b[^\n]*-(?:Recurse|Force)\b|del\s+\/s\b|format\s+[A-Za-z]:)/i;

export function classifyShellRisk(command: string): ShellRiskKind {
  const text = command.trim();
  if (!text) return "routine";
  if (DESTRUCTIVE_SHELL_PATTERN.test(text)) return "destructive";
  if (OUTBOUND_SHELL_PATTERN.test(text)) return "outbound";
  if (GIT_MUTATION_SHELL_PATTERN.test(text)) return "git_mutation";
  return "routine";
}

export function shellRiskLabel(risk: ShellRiskKind): string {
  switch (risk) {
    case "destructive":
      return "破坏性命令";
    case "outbound":
      return "联网/下载命令";
    case "git_mutation":
      return "Git 写操作";
    default:
      return "常规命令";
  }
}

const SECRET_BASENAMES = new Set([
  ".env",
  "id_rsa",
  "id_rsa.pub",
  "id_ed25519",
  "id_ed25519.pub",
  "id_ecdsa",
  "id_ecdsa.pub",
  "id_dsa",
  "id_dsa.pub",
]);

/**
 * Whether a path names a credential/secret file the agent must not touch.
 * Normalizes separators so it behaves the same on Windows and POSIX.
 */
export function isSecretPath(target: string): boolean {
  if (!target) return false;
  const normalized = resolve(target).replace(/\\/g, "/").toLowerCase();
  const segments = normalized.split("/");
  if (segments.includes(".ssh")) return true;
  const gitHooksIndex = segments.lastIndexOf("hooks");
  if (gitHooksIndex > 0 && segments[gitHooksIndex - 1] === ".git") return true;

  const base = basename(normalized);
  if (SECRET_BASENAMES.has(base) || base.startsWith(".env.")) return true;
  if (base.endsWith(".pem") || base.endsWith(".pfx") || base.endsWith(".p12")) return true;
  return false;
}
