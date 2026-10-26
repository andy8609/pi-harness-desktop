/**
 * T7 工具发现、命名空间映射与注册中心合并测试。
 *
 * 运行：npm run test:mcp
 */
import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { McpRuntime } from "../src/main/mcp/runtime.ts";
import { McpToolBridge, normalizeParameters } from "../src/main/mcp/tools.ts";

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

/** 最小 ExtensionAPI 替身：只实现 bridge 用到的四个方法。 */
function fakePi(initialActive = ["read", "bash"]) {
  const tools = new Map();
  let active = [...initialActive];
  return {
    tools,
    get active() {
      return [...active];
    },
    registerTool(definition) {
      tools.set(definition.name, definition);
    },
    getActiveTools() {
      return [...active];
    },
    setActiveTools(names) {
      active = [...names];
    },
    on() {
      // 扩展生命周期钩子与本测试无关
    },
  };
}

function fakeClient(tools) {
  const state = { closed: false };
  return {
    async connect() {
      state.closed = false;
      return tools.map((name) => ({ name, description: `${name} 工具`, inputSchema: { type: "object" } }));
    },
    async callTool(tool) {
      return { content: [{ type: "text", text: `called:${tool}` }] };
    },
    getTools() {
      return state.closed ? [] : tools.map((name) => ({ name, inputSchema: { type: "object" } }));
    },
    isConnected() {
      return !state.closed;
    },
    close() {
      state.closed = true;
    },
  };
}

test("连接后把工具注册进 pi，并保留内置工具", async () => {
  const runtime = new McpRuntime();
  runtime.setProjectPath(process.cwd());
  runtime.setRecords([record()]);
  const pi = fakePi(["read", "bash"]);
  const bridge = new McpToolBridge({ runtime });
  bridge.attach(pi);

  await runtime.toolsForProject();
  bridge.sync();

  assert.deepEqual([...pi.tools.keys()].sort(), [
    "mcp_mock_add",
    "mcp_mock_big",
    "mcp_mock_echo",
    "mcp_mock_fail",
    "mcp_mock_slow",
  ]);
  assert.deepEqual(pi.active.slice(0, 2), ["read", "bash"]);
  assert.equal(pi.active.length, 7);

  // 工具定义可执行，且结果经序列化
  const echo = pi.tools.get("mcp_mock_echo");
  const result = await echo.execute("call-1", { text: "hi" });
  assert.equal(result.content[0].text, "hi");
  assert.equal(result.details.serverId, "mock");
  runtime.disposeAll();
});

test("服务器移除后工具从激活集合消失（定义保留）", async () => {
  const runtime = new McpRuntime();
  runtime.setProjectPath(process.cwd());
  runtime.setRecords([record()]);
  const pi = fakePi();
  const bridge = new McpToolBridge({ runtime });
  bridge.attach(pi);
  await runtime.toolsForProject();
  bridge.sync();
  assert.equal(pi.active.filter((name) => name.startsWith("mcp_")).length, 5);

  runtime.setRecords([]);
  bridge.sync();
  assert.deepEqual(pi.active, ["read", "bash"]);
  // pi 没有 unregisterTool：定义仍在注册表，但不再激活
  assert.equal(pi.tools.size, 5);
  runtime.disposeAll();
});

test("工具级开关过滤注册结果", async () => {
  const runtime = new McpRuntime({ createClient: () => fakeClient(["echo", "write"]) });
  runtime.setRecords([record({ disabledTools: ["write"] })]);
  const pi = fakePi();
  const bridge = new McpToolBridge({ runtime });
  bridge.attach(pi);
  await runtime.toolsForProject();
  bridge.sync();

  assert.deepEqual([...pi.tools.keys()], ["mcp_mock_echo"]);
  assert.deepEqual(pi.active, ["read", "bash", "mcp_mock_echo"]);
});

test("sanitize 后撞名：先注册者胜，冲突可查询", async () => {
  const runtime = new McpRuntime({
    createClient: (options) => fakeClient(options.serverId === "a-b" ? ["echo"] : ["echo"]),
  });
  runtime.setRecords([
    record({ id: "a-b", label: "A dash" }),
    record({ id: "a_b", label: "A underscore" }),
  ]);
  const pi = fakePi();
  const bridge = new McpToolBridge({ runtime });
  bridge.attach(pi);
  await runtime.toolsForProject();
  bridge.sync();

  assert.deepEqual([...pi.tools.keys()], ["mcp_a_b_echo"]);
  assert.deepEqual(bridge.listConflicts(), [{ fullName: "mcp_a_b_echo", skippedServerId: "a_b" }]);
});

test("参数 schema 的边界情况", () => {
  assert.deepEqual(normalizeParameters({ type: "object", properties: { a: { type: "string" } } }), {
    type: "object",
    properties: { a: { type: "string" } },
  });
  assert.deepEqual(normalizeParameters(undefined), { type: "object", properties: {} });
  assert.deepEqual(normalizeParameters({ type: "string" }), { type: "object", properties: {} });
});
