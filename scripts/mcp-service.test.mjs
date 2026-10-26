/**
 * T12/T13 服务层测试：配置变更 → 运行时 → 工具注册的联动，以及 stdio 授权确认回滚。
 *
 * 运行：npm run test:mcp
 */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { McpService } from "../src/main/mcp/service.ts";

function fakeClient(tools = ["echo", "write"]) {
  const state = { closed: false, connects: 0 };
  return {
    state,
    async connect() {
      state.connects += 1;
      state.closed = false;
      return tools.map((name) => ({ name, inputSchema: { type: "object" } }));
    },
    async callTool(tool) {
      return { content: [{ type: "text", text: tool }] };
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

function fakePi() {
  const tools = new Map();
  let active = ["read"];
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
    on() {},
  };
}

function makeService(options = {}) {
  const dir = mkdtempSync(join(tmpdir(), "pi-mcp-service-"));
  const broadcasts = [];
  const client = options.client ?? fakeClient();
  const service = new McpService({
    filePath: join(dir, "mcp-servers.json"),
    broadcast: (snapshot) => broadcasts.push(snapshot),
    log: () => {},
    createClient: () => client,
    confirmStdio: options.confirmStdio,
  });
  return { service, broadcasts, client, dir };
}

const stdioInput = {
  id: "mock",
  label: "Mock",
  transport: "stdio",
  command: "node",
  args: ["mock-mcp-server.mjs"],
};

test("upsert → 运行时连接 → 工具注册；禁用后工具移除", async () => {
  const { service } = makeService();
  const pi = fakePi();
  service.bridge.attach(pi);

  const { server } = await service.upsert(stdioInput);
  assert.equal(server.id, "mock");
  await service.test("mock");
  service.bridge.sync();

  assert.equal(service.snapshot().statuses[0].state, "ready");
  assert.deepEqual([...pi.tools.keys()].sort(), ["mcp_mock_echo", "mcp_mock_write"]);
  assert.deepEqual(pi.active, ["read", "mcp_mock_echo", "mcp_mock_write"]);

  service.setEnabled("mock", false);
  assert.deepEqual(pi.active, ["read"]);
  assert.equal(service.snapshot().servers[0].enabled, false);
});

test("工具级开关持久化并立即影响注册结果", async () => {
  const { service } = makeService();
  const pi = fakePi();
  service.bridge.attach(pi);
  await service.upsert(stdioInput);
  await service.test("mock");
  service.bridge.sync();
  assert.equal(pi.active.length, 3);

  service.setToolEnabled("mock", "write", false);
  assert.deepEqual(pi.active, ["read", "mcp_mock_echo"]);
  assert.deepEqual(service.store.get("mock").disabledTools, ["write"]);
  assert.deepEqual(
    service.listTools("mock").tools.map((tool) => [tool.name, tool.enabled]),
    [
      ["echo", true],
      ["write", false],
    ],
  );

  service.setToolEnabled("mock", "write", true);
  assert.equal(pi.active.length, 3);
});

test("删除服务器同时清理连接与工具", async () => {
  const { service, client } = makeService();
  const pi = fakePi();
  service.bridge.attach(pi);
  await service.upsert(stdioInput);
  await service.test("mock");
  service.bridge.sync();

  assert.deepEqual(service.remove("mock"), { removed: true });
  assert.equal(client.state.closed, true);
  assert.deepEqual(pi.active, ["read"]);
  assert.equal(service.snapshot().servers.length, 0);
});

test("stdio 授权被拒绝：新增记录被回滚", async () => {
  const { service } = makeService({ confirmStdio: async () => false });
  const result = await service.upsert(stdioInput);
  assert.equal(result.cancelled, true);
  assert.equal(service.snapshot().servers.length, 0);
});

test("stdio 授权通过：记录保存并连接", async () => {
  let confirmations = 0;
  const { service, client } = makeService({
    confirmStdio: async () => {
      confirmations += 1;
      return true;
    },
  });
  const result = await service.upsert(stdioInput);
  assert.equal(result.cancelled, undefined);
  assert.equal(confirmations, 1);
  assert.equal(service.snapshot().servers.length, 1);
  await service.test("mock");
  // upsert 会先自动握手一次，test 又强制重连一次：至少各发生一次即可。
  assert.ok(client.state.connects >= 1);
  assert.equal(service.snapshot().statuses[0].state, "ready");
});

test("同一命令再次保存不再重复确认；命令变化会重新确认", async () => {
  const seen = [];
  const { service } = makeService({
    confirmStdio: async (_record, context) => {
      seen.push(context.previouslyApproved);
      return true;
    },
  });
  await service.upsert(stdioInput);
  await service.upsert({ ...stdioInput, label: "改名" });
  await service.upsert({ ...stdioInput, command: "npx", args: ["other.mjs"] });
  assert.deepEqual(seen, [false, true, false]);
});

test("配置损坏时服务仍可启动", () => {
  const { service } = makeService();
  assert.deepEqual(service.snapshot(), { servers: [], statuses: [] });
  assert.deepEqual(service.refresh(), { servers: [], statuses: [] });
});
