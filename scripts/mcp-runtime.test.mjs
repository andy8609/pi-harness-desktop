/**
 * T6 连接管理器测试：状态机、失败隔离、重连、超时、真实 stdio 往返。
 *
 * 运行：npm run test:mcp
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { McpCallError, McpRuntime } from "../src/main/mcp/runtime.ts";

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

/** 假客户端：用于观察调用次数与强制失败。 */
function fakeClient(name, tools, behaviour = {}) {
  const state = { connects: 0, closes: 0, closed: false, calls: [] };
  return {
    state,
    client: {
      async connect() {
        state.connects += 1;
        if (behaviour.failConnect) throw new Error(behaviour.failConnect);
        state.closed = false;
        return tools.map((tool) => ({ name: tool, inputSchema: { type: "object" } }));
      },
      async callTool(tool, args) {
        state.calls.push({ tool, args });
        if (behaviour.failCall) throw new Error(behaviour.failCall);
        return { content: [{ type: "text", text: `${name}:${tool}` }] };
      },
      getTools() {
        return state.closed ? [] : tools.map((tool) => ({ name: tool, inputSchema: { type: "object" } }));
      },
      isConnected() {
        return !state.closed;
      },
      close() {
        state.closes += 1;
        state.closed = true;
      },
    },
  };
}

test("多服务器：一台失败不影响另一台，状态各自独立", async () => {
  const good = fakeClient("good", ["echo"]);
  const bad = fakeClient("bad", ["x"], { failConnect: "boom" });
  const clients = { good: good.client, bad: bad.client };
  const runtime = new McpRuntime({ createClient: (options) => clients[options.serverId] });
  runtime.setRecords([
    record({ id: "good", label: "Good" }),
    record({ id: "bad", label: "Bad" }),
  ]);

  const descriptors = await runtime.toolsForProject();
  assert.deepEqual(descriptors.map((item) => item.fullName), ["mcp_good_echo"]);
  assert.equal(runtime.statusFor("good").state, "ready");
  assert.equal(runtime.statusFor("bad").state, "failed");
  assert.match(runtime.statusFor("bad").message, /boom/);
});

test("失败服务器不会在下次装配时重复握手", async () => {
  const bad = fakeClient("bad", ["x"], { failConnect: "boom" });
  const runtime = new McpRuntime({ createClient: () => bad.client });
  runtime.setRecords([record({ id: "bad", label: "Bad" })]);
  await runtime.toolsForProject();
  await runtime.toolsForProject();
  assert.equal(bad.state.connects, 1);

  // 手动测试连接会强制重试
  await runtime.test("bad");
  assert.equal(bad.state.connects, 2);
});

test("配置变化会断开旧连接，label 变化不会", async () => {
  const fake = fakeClient("mock", ["echo"]);
  const changes = [];
  const runtime = new McpRuntime({
    createClient: () => fake.client,
    onChanged: () => changes.push(1),
  });
  runtime.setRecords([record()]);
  await runtime.toolsForProject();
  assert.equal(fake.state.connects, 1);
  runtime.setRecords([record({ label: "新名字" })]);
  assert.equal(fake.state.closes, 0);
  runtime.setRecords([record({ args: ["other.mjs"] })]);
  assert.equal(fake.state.closes, 1);
  assert.ok(changes.length >= 1);
});

test("callTool：命名空间路由、未知工具与禁用工具", async () => {
  const fake = fakeClient("mock", ["echo", "add"]);
  const runtime = new McpRuntime({ createClient: () => fake.client });
  runtime.setRecords([record()]);
  await runtime.toolsForProject();

  const result = await runtime.callTool("mcp_mock_echo", { text: "hi" });
  assert.deepEqual(result, { content: [{ type: "text", text: "mock:echo" }] });
  assert.deepEqual(fake.state.calls[0], { tool: "echo", args: { text: "hi" } });

  await assert.rejects(
    () => runtime.callTool("mcp_mock_missing", {}),
    (error) => error instanceof McpCallError && error.code === "TOOL_NOT_FOUND",
  );

  runtime.setRecords([record({ disabledTools: ["echo"] })]);
  await assert.rejects(
    () => runtime.callTool("mcp_mock_echo", {}),
    (error) => error instanceof McpCallError && error.code === "TOOL_DISABLED",
  );
});

test("scope 过滤：项目不匹配时工具不可用", async () => {
  const fake = fakeClient("mock", ["echo"]);
  const runtime = new McpRuntime({ createClient: () => fake.client });
  runtime.setRecords([record({ scope: { mode: "projects", projects: ["D:/work/a"] } })]);

  runtime.setProjectPath("D:/work/b");
  assert.deepEqual(await runtime.toolsForProject(), []);
  assert.equal(fake.state.connects, 0);

  runtime.setProjectPath("D:/work/a");
  assert.equal((await runtime.toolsForProject()).length, 1);
  assert.equal(fake.state.connects, 1);
});

test("真实 stdio：握手、工具发现、调用与关闭", async () => {
  const runtime = new McpRuntime({ connectTimeoutMs: 10_000 });
  runtime.setRecords([record()]);
  runtime.setProjectPath(process.cwd());

  const descriptors = await runtime.toolsForProject();
  assert.deepEqual(descriptors.map((item) => item.toolName).sort(), ["add", "big", "echo", "fail", "slow"]);
  const status = runtime.statusFor("mock");
  assert.equal(status.state, "ready");
  assert.equal(status.toolCount, 5);

  const echoed = await runtime.callTool("mcp_mock_echo", { text: "hello" });
  assert.equal(echoed.content[0].text, "hello");

  await assert.rejects(() => runtime.callTool("mcp_mock_fail", { message: "nope" }), /nope/);

  runtime.disposeAll();
  assert.equal(runtime.statusFor("mock").state, "idle");
});

test("disposeAll 后子进程确实退出（无残留）", async () => {
  const pidFile = join(tmpdir(), `pi-mcp-pid-${process.pid}-${Date.now()}.txt`);
  const runtime = new McpRuntime();
  runtime.setRecords([record({ env: { MOCK_MCP_PID_FILE: pidFile } })]);
  await runtime.toolsForProject();
  const pid = Number(readFileSync(pidFile, "utf8"));
  assert.ok(pid > 0, "mock 服务器应写出自己的 pid");

  runtime.disposeAll();
  let alive = true;
  for (let attempt = 0; attempt < 40 && alive; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    try {
      process.kill(pid, 0);
    } catch {
      alive = false;
    }
  }
  assert.equal(alive, false, "disposeAll 后不应残留子进程");
});

test("连接超时：对端不响应时状态为 failed", async () => {
  const runtime = new McpRuntime({ connectTimeoutMs: 300 });
  runtime.setRecords([
    record({
      id: "silent",
      args: ["-e", "process.stdin.resume()"],
    }),
  ]);
  const descriptors = await runtime.toolsForProject();
  assert.deepEqual(descriptors, []);
  const status = runtime.statusFor("silent");
  assert.equal(status.state, "failed");
  assert.match(status.message, /超时|timed out/);
  runtime.disposeAll();
});

test("命令校验：拒绝 .. 与相对路径", async () => {
  const runtime = new McpRuntime({ connectTimeoutMs: 500 });
  runtime.setRecords([record({ id: "escape", command: "../bin/node" })]);
  await runtime.toolsForProject();
  assert.equal(runtime.statusFor("escape").state, "failed");
  assert.match(runtime.statusFor("escape").message, /\.\./);

  runtime.setRecords([record({ id: "relative", command: "./bin/node" })]);
  await runtime.toolsForProject();
  assert.match(runtime.statusFor("relative").message, /绝对路径/);
});
