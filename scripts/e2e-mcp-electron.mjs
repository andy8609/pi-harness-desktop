#!/usr/bin/env node
/**
 * T15 端到端实测：在真实 Electron main 进程里验证 MCP 全链路。
 *
 * 覆盖：
 *   1. 读取外部配置文件（PI_MCP_CONFIG_PATH）
 *   2. stdio 服务器（scripts/mock-mcp-server.mjs）连接与工具调用
 *   3. HTTP 服务器（本脚本内置，SSE 响应）连接与工具调用
 *   4. 工具返回 isError 时调用被判定为失败
 *
 * 用法：
 *   node scripts/e2e-mcp-electron.mjs                                  # 开发产物
 *   PI_E2E_BINARY="release/win-unpacked/Pi Desktop.exe" node scripts/e2e-mcp-electron.mjs  # 打包产物
 * 前置：npm run build（开发产物）或 npx electron-builder --dir（打包产物）
 */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const electronPath = require("electron");
const here = dirname(fileURLToPath(import.meta.url));
const root = dirname(here);

if (!process.env.PI_E2E_BINARY?.trim() && !existsSync(join(root, "out", "main", "index.js"))) {
  console.error("缺少构建产物：请先运行 npm run build");
  process.exit(1);
}

/** 内置 HTTP MCP 服务器：验证 SSE 响应分支。 */
function startHttpMcpServer() {
  const server = createServer((req, res) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      const message = JSON.parse(body || "{}");
      const result =
        message.method === "initialize"
          ? { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "e2e-http", version: "1" } }
          : message.method === "tools/list"
            ? {
                tools: [
                  {
                    name: "echo",
                    description: "HTTP echo",
                    inputSchema: {
                      type: "object",
                      properties: { text: { type: "string" } },
                      required: ["text"],
                    },
                  },
                  { name: "fail", description: "HTTP failure", inputSchema: { type: "object" } },
                ],
              }
            : message.params?.name === "fail"
              ? { content: [{ type: "text", text: "http-expected-failure" }], isError: true }
              : { content: [{ type: "text", text: `http:${message.params?.arguments?.text ?? ""}` }] };
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: message.id, result })}\n\n`);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
  });
}

async function waitForFile(path, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(path)) return true;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return false;
}

const { server, port } = await startHttpMcpServer();
const dir = mkdtempSync(join(tmpdir(), "pi-mcp-e2e-"));
const configPath = join(dir, "mcp-servers.json");
const outputPath = join(dir, "selftest.json");
const now = new Date().toISOString();

writeFileSync(
  configPath,
  `${JSON.stringify(
    {
      version: 1,
      servers: [
        {
          id: "mock-stdio",
          label: "Mock stdio",
          transport: "stdio",
          command: process.execPath,
          args: [join(root, "scripts", "mock-mcp-server.mjs")],
          enabled: true,
          scope: { mode: "global", projects: [] },
          createdAt: now,
          updatedAt: now,
        },
        {
          id: "mock-http",
          label: "Mock HTTP",
          transport: "http",
          url: `http://127.0.0.1:${port}/mcp`,
          enabled: true,
          scope: { mode: "global", projects: [] },
          createdAt: now,
          updatedAt: now,
        },
      ],
    },
    null,
    2,
  )}\n`,
  "utf8",
);

// 设置 PI_E2E_BINARY 可对打包产物（release/win-unpacked/Pi Desktop.exe）跑同一套自检。
const packagedBinary = process.env.PI_E2E_BINARY?.trim();
const binary = packagedBinary || electronPath;
const binaryArgs = packagedBinary ? [] : [root];

const logs = [];
const child = spawn(binary, binaryArgs, {
  env: {
    ...process.env,
    PI_MCP_CONFIG_PATH: configPath,
    PI_MCP_SELFTEST: outputPath,
  },
  stdio: ["ignore", "pipe", "pipe"],
});
child.stdout.setEncoding("utf8");
child.stderr.setEncoding("utf8");
child.stdout.on("data", (chunk) => logs.push(String(chunk)));
child.stderr.on("data", (chunk) => logs.push(String(chunk)));

let exitCode;
child.on("exit", (code) => {
  exitCode = code;
});

const finished = await waitForFile(outputPath, 60_000);
if (!finished) {
  child.kill();
  server.close();
  console.error("自检超时。Electron 输出：\n" + logs.join("").slice(-4000));
  process.exit(1);
}

// 等待进程收尾，避免读到写了一半的文件
await new Promise((resolve) => setTimeout(resolve, 300));
const result = JSON.parse(readFileSync(outputPath, "utf8"));
if (!exitCode && exitCode !== 0) child.kill();
server.close();

const failures = [];
if (result.ok !== true) failures.push(`自检 ok=${result.ok}，error=${result.error ?? "无"}`);
const names = result.toolNames ?? [];
for (const expected of ["mcp_mock_stdio_echo", "mcp_mock_http_echo"]) {
  if (!names.includes(expected)) failures.push(`缺少工具 ${expected}`);
}
for (const status of result.statuses ?? []) {
  if (status.state !== "ready") failures.push(`服务器 ${status.serverId} 状态 ${status.state}: ${status.message ?? ""}`);
}
if (result.echo?.content?.[0]?.text !== "selftest") {
  failures.push(`stdio echo 结果异常：${JSON.stringify(result.echo)}`);
}
if (result.failToolRejected !== true) failures.push("isError 工具未被判定为失败");

if (failures.length > 0) {
  console.error("端到端实测失败：");
  for (const item of failures) console.error(` - ${item}`);
  console.error(JSON.stringify(result, null, 2));
  console.error("Electron 输出：\n" + logs.join("").slice(-4000));
  process.exit(1);
}

console.log("端到端实测通过");
console.log(
  JSON.stringify(
    {
      electron: result.electron,
      node: result.node,
      toolCount: result.toolCount,
      toolNames: result.toolNames,
      statuses: result.statuses?.map((status) => ({ serverId: status.serverId, state: status.state, toolCount: status.toolCount })),
      echo: result.echo?.content?.[0]?.text,
      failToolRejected: result.failToolRejected,
    },
    null,
    2,
  ),
);
