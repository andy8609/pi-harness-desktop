import { writeFileSync } from "node:fs";
import type { McpService } from "./service";

/**
 * 仅测试用的启动自检：在真实 Electron main 进程里走一遍
 * 「配置 → 连接 → 工具发现 → 工具调用」。
 *
 * 由 `PI_MCP_SELFTEST=<输出文件>` 触发（见 `scripts/e2e-mcp-electron.mjs`）。
 * 不参与正常启动路径。
 */
export async function runMcpSelfTest(service: McpService, outputPath: string): Promise<void> {
  const result: Record<string, unknown> = { ok: false, node: process.versions.node, electron: process.versions.electron };
  try {
    service.initialize(null);
    const descriptors = await service.runtime.toolsForProject();
    result.toolCount = descriptors.length;
    result.toolNames = descriptors.map((descriptor) => descriptor.fullName);
    result.statuses = service.snapshot().statuses;

    const echo = descriptors.find((descriptor) => descriptor.toolName === "echo");
    if (echo) {
      result.echo = await service.runtime.callTool(echo.fullName, { text: "selftest" });
    } else {
      result.missingEcho = true;
    }

    try {
      const fail = descriptors.find((descriptor) => descriptor.toolName === "fail");
      if (fail) await service.runtime.callTool(fail.fullName, { message: "expected-failure" });
      result.failToolRejected = false;
    } catch (error) {
      result.failToolRejected = true;
      result.failToolMessage = error instanceof Error ? error.message : String(error);
    }

    result.ok = Boolean(echo) && result.failToolRejected === true;
  } catch (error) {
    result.error = error instanceof Error ? error.stack ?? error.message : String(error);
  } finally {
    try {
      writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
    } catch {
      // 写不出结果时由 e2e 脚本判定超时失败
    }
    service.dispose();
  }
}
