import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { McpToolBridge } from "../mcp/tools";

/**
 * MCP 工具注入扩展。
 *
 * 只负责把 bridge 挂到当前会话的 ExtensionAPI 上，并在会话边界刷新一次；
 * 工具本身的注册由 `McpToolBridge.sync()` 完成（连接状态变化时也会被调用）。
 */
export function createMcpExtension(bridge: McpToolBridge): (pi: ExtensionAPI) => void {
  return (pi: ExtensionAPI): void => {
    bridge.attach(pi);
    pi.on("session_start", async () => {
      // 会话建立时可能已经有缓存工具（例如同项目第二次开会话），先对齐一次。
      bridge.sync();
    });
    pi.on("session_shutdown", async () => {
      bridge.detach();
    });
  };
}
