/**
 * T7/T9 集成测试：把 MCP 工具接进真实 pi 扩展运行时与会话。
 *
 * 不调用模型、不联网：只验证工具注册与激活集合。
 * 运行：npm run test:mcp
 */
import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import {
  ModelRuntime,
  SessionManager,
  createAgentSessionFromServices,
  createAgentSessionServices,
} from "@earendil-works/pi-coding-agent";
import { createMcpExtension } from "../src/main/extensions/mcp.ts";
import { McpRuntime } from "../src/main/mcp/runtime.ts";
import { McpToolBridge } from "../src/main/mcp/tools.ts";

const mockServer = join(process.cwd(), "scripts", "mock-mcp-server.mjs");

function record(overrides = {}) {
  return {
    id: "mock",
    label: "Mock",
    transport: "stdio",
    command: process.execPath,
    args: [mockServer],
    enabled: true,
    scope: { mode: "global", projects: [] },
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    ...overrides,
  };
}

test("真实扩展运行时：会话工具集包含 MCP 工具，移除服务器后消失", async () => {
  const runtime = new McpRuntime();
  runtime.setProjectPath(process.cwd());
  runtime.setRecords([record()]);
  await runtime.toolsForProject();

  const bridge = new McpToolBridge({ runtime });
  const modelRuntime = await ModelRuntime.create({ allowModelNetwork: false, refreshOnCreate: false });
  const services = await createAgentSessionServices({
    cwd: process.cwd(),
    modelRuntime,
    resourceLoaderOptions: { extensionFactories: [createMcpExtension(bridge)] },
  });
  const created = await createAgentSessionFromServices({
    services,
    sessionManager: SessionManager.inMemory(process.cwd()),
  });
  const session = created.session;

  const registered = session.getAllTools().map((tool) => tool.name).filter((name) => name.startsWith("mcp_"));
  assert.deepEqual(registered.sort(), [
    "mcp_mock_add",
    "mcp_mock_big",
    "mcp_mock_echo",
    "mcp_mock_fail",
    "mcp_mock_slow",
  ]);
  const active = session.getActiveToolNames().filter((name) => name.startsWith("mcp_"));
  assert.equal(active.length, 5);

  // 运行时移除服务器 → bridge 同步 → 工具不再激活（定义保留）
  runtime.setRecords([]);
  bridge.sync();
  assert.deepEqual(session.getActiveToolNames().filter((name) => name.startsWith("mcp_")), []);
  assert.equal(session.getToolDefinition("mcp_mock_echo")?.name, "mcp_mock_echo");

  runtime.disposeAll();
  await created.session.dispose?.();
});
