#!/usr/bin/env node
/**
 * 最小 MCP stdio 服务器，用于本地联调与测试。
 *
 * 支持：initialize、notifications/initialized、tools/list、tools/call、ping。
 * 工具：
 *   - echo(text)      回显文本
 *   - add(a, b)       两数相加，返回 structuredContent
 *   - fail(message)   返回 isError: true
 *   - slow(ms)        延迟后返回，用于超时测试
 *   - big()           返回超过 32 KiB 的文本
 *
 * 用法：node scripts/mock-mcp-server.mjs
 */
import { writeFileSync } from "node:fs";
import { createInterface } from "node:readline";

const PROTOCOL_VERSION = "2025-06-18";

// 测试用：把自身 pid 写到文件，便于断言 parent 关闭后子进程确实退出。
if (process.env.MOCK_MCP_PID_FILE) {
  writeFileSync(process.env.MOCK_MCP_PID_FILE, String(process.pid), "utf8");
}

const TOOLS = [
  {
    name: "echo",
    description: "回显输入文本",
    inputSchema: {
      type: "object",
      properties: { text: { type: "string", description: "要回显的文本" } },
      required: ["text"],
    },
  },
  {
    name: "add",
    description: "两数相加",
    inputSchema: {
      type: "object",
      properties: { a: { type: "number" }, b: { type: "number" } },
      required: ["a", "b"],
    },
  },
  {
    name: "fail",
    description: "总是失败，用于错误路径测试",
    inputSchema: {
      type: "object",
      properties: { message: { type: "string" } },
    },
  },
  {
    name: "slow",
    description: "延迟返回，用于超时测试",
    inputSchema: {
      type: "object",
      properties: { ms: { type: "number" } },
    },
  },
  {
    name: "big",
    description: "返回大文本，用于截断测试",
    inputSchema: { type: "object", properties: {} },
  },
];

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function text(value) {
  return { content: [{ type: "text", text: String(value) }] };
}

async function callTool(name, args) {
  const input = args && typeof args === "object" ? args : {};
  switch (name) {
    case "echo":
      return text(input.text ?? "");
    case "add": {
      const sum = Number(input.a ?? 0) + Number(input.b ?? 0);
      return {
        content: [{ type: "text", text: String(sum) }],
        structuredContent: { sum },
      };
    }
    case "fail":
      return { content: [{ type: "text", text: input.message ?? "mock failure" }], isError: true };
    case "slow": {
      const ms = Math.min(Number(input.ms ?? 100), 10_000);
      await new Promise((resolve) => setTimeout(resolve, ms));
      return text(`waited ${ms}ms`);
    }
    case "big":
      return text("x".repeat(40 * 1024));
    default:
      throw Object.assign(new Error(`unknown tool: ${name}`), { code: -32602 });
  }
}

const rl = createInterface({ input: process.stdin, crlfDelay: Number.POSITIVE_INFINITY });

rl.on("line", async (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let message;
  try {
    message = JSON.parse(trimmed);
  } catch {
    return;
  }
  const { id, method, params } = message;
  // 通知（无 id）不需要响应
  if (id === undefined || id === null) return;
  try {
    if (method === "initialize") {
      send({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: "mock-mcp-server", version: "1.0.0" },
        },
      });
      return;
    }
    if (method === "ping") {
      send({ jsonrpc: "2.0", id, result: {} });
      return;
    }
    if (method === "tools/list") {
      send({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
      return;
    }
    if (method === "tools/call") {
      const name = String(params?.name ?? "");
      const result = await callTool(name, params?.arguments);
      send({ jsonrpc: "2.0", id, result });
      return;
    }
    send({ jsonrpc: "2.0", id, error: { code: -32601, message: `method not found: ${method}` } });
  } catch (error) {
    send({ jsonrpc: "2.0", id, error: { code: -32603, message: String(error?.message ?? error) } });
  }
});
