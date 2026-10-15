import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { DialogBroker } from "../dialog-broker";
import type { PermissionStore } from "../permission-store";
import { classifyShellRisk, isSecretPath, shellRiskLabel } from "../permission-policy";

const DECISIONS = ["仅本次允许", "本会话允许", "始终允许", "拒绝"] as const;
type Decision = (typeof DECISIONS)[number];

/**
 * Built-in pi extension providing a permission gate with remembered decisions.
 *
 * pi does not ship permission popups, but an extension can intercept
 * `tool_call` and return `{ block, reason }`, while `ctx.ui`/the dialog broker
 * provides the approval surface.
 *
 * - Secret/credential paths are hard-blocked for read/write/edit.
 * - High-risk shell commands ask once, and can be remembered per session or
 *   persisted to disk.
 * - Project full-trust skips those prompts (secret paths stay blocked).
 */
export function createPermissionExtension(
  dialogs: DialogBroker,
  store: PermissionStore,
  getCwd: () => string,
): (pi: ExtensionAPI) => void {
  return (pi: ExtensionAPI): void => {
    pi.on("tool_call", async (event) => {
      const input = event.input as { command?: unknown; path?: unknown };

      if (event.toolName === "read" || event.toolName === "write" || event.toolName === "edit") {
        const target = typeof input.path === "string" ? input.path : "";
        if (target && isSecretPath(target)) {
          return {
            block: true,
            reason: `路径「${target}」属于密钥或凭据文件，已禁止访问。请不要重试该路径。`,
          };
        }
        return;
      }

      if (event.toolName === "bash" || event.toolName === "powershell") {
        const command = typeof input.command === "string" ? input.command : "";
        const risk = classifyShellRisk(command);
        if (risk === "routine") return;
        if (store.isFullTrust(getCwd())) return;

        const key = `shell:${risk}:${command.replace(/\s+/g, " ").trim()}`;
        if (store.isAllowed(key)) return;

        const selected = (await dialogs.ask({
          kind: "permission",
          title: `需要确认：${shellRiskLabel(risk)}`,
          message: command,
          permission: {
            toolName: event.toolName,
            risk: shellRiskLabel(risk),
            detail: command,
            options: DECISIONS.map((decision) => ({ id: decision, label: decision })),
          },
        })) as Decision | undefined;

        if (!selected || selected === "拒绝") {
          return {
            block: true,
            reason: "用户拒绝了该命令。请改用更安全的做法，不要重试同一条命令。",
          };
        }
        if (selected === "本会话允许") store.allowSession(key);
        if (selected === "始终允许") store.allowAlways(key);
      }
    });
  };
}
