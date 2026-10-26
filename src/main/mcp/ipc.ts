import { ipcMain } from "electron";
import type { McpScope, McpServerInput } from "@shared/mcp";
import { wrap } from "../ipc";
import type { McpService } from "./service";

/**
 * MCP 的 IPC 通道（`mcp:` 域）。
 *
 * 放在独立模块里，让 `ipc.ts` 继续只承担「应用级通道清单」的角色。
 * 所有 handler 都走统一的 wrap，错误以 Error(message) 形式回到渲染层。
 */
export function registerMcpIpc(service: McpService): void {
  ipcMain.handle("mcp:list", () => wrap(() => service.snapshot()));

  ipcMain.handle("mcp:upsert", (_event, input: McpServerInput) => wrap(() => service.upsert(input)));

  ipcMain.handle("mcp:remove", (_event, payload: { id: string }) =>
    wrap(() => service.remove(String(payload?.id ?? ""))),
  );

  ipcMain.handle("mcp:setEnabled", (_event, payload: { id: string; enabled: boolean }) =>
    wrap(() => service.setEnabled(String(payload?.id ?? ""), payload?.enabled === true)),
  );

  ipcMain.handle("mcp:setScope", (_event, payload: { id: string; scope: McpScope }) =>
    wrap(() => service.setScope(String(payload?.id ?? ""), payload?.scope)),
  );

  ipcMain.handle("mcp:test", (_event, payload: { id: string }) =>
    wrap(() => service.test(String(payload?.id ?? ""))),
  );

  ipcMain.handle("mcp:reconnect", (_event, payload: { id: string }) =>
    wrap(() => service.reconnect(String(payload?.id ?? ""))),
  );

  ipcMain.handle("mcp:disconnect", (_event, payload: { id: string }) =>
    wrap(() => service.disconnect(String(payload?.id ?? ""))),
  );

  ipcMain.handle("mcp:listTools", (_event, payload: { id: string }) =>
    wrap(() => service.listTools(String(payload?.id ?? ""))),
  );

  ipcMain.handle(
    "mcp:setToolEnabled",
    (_event, payload: { id: string; toolName: string; enabled: boolean }) =>
      wrap(() =>
        service.setToolEnabled(
          String(payload?.id ?? ""),
          String(payload?.toolName ?? ""),
          payload?.enabled === true,
        ),
      ),
  );

  ipcMain.handle("mcp:refresh", () => wrap(() => service.refresh()));
}
