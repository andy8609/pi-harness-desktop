#!/usr/bin/env node
/**
 * T4 环境探针：验证 MCP 所需的两个运行时能力在当前 Node/Electron 运行时可用。
 *
 * 1. stdio：spawn 子进程 + 逐行 NDJSON JSON-RPC 往返（initialize / tools/list / tools/call）
 * 2. http ：全局 fetch + POST JSON-RPC + JSON 响应解析
 *
 * 不依赖任何第三方包，也不需要启动 Electron。
 * 用法：node scripts/mcp-env-probe.mjs
 */
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

/** 极简 JSON-RPC 客户端，仅用于探针。 */
function lineClient(child) {
  let buffer = "";
  const pending = new Map();
  let nextId = 1;

  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    let index = buffer.indexOf("\n");
    while (index >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (line) {
        try {
          const message = JSON.parse(line);
          const entry = pending.get(message.id);
          if (entry) {
            pending.delete(message.id);
            entry.resolve(message);
          }
        } catch {
          // 忽略非 JSON 行
        }
      }
      index = buffer.indexOf("\n");
    }
  });

  return {
    request(method, params) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
        setTimeout(() => {
          if (pending.delete(id)) reject(new Error(`${method} timed out`));
        }, 5000);
      });
    },
  };
}

async function probeStdio() {
  const child = spawn(process.execPath, [join(here, "mock-mcp-server.mjs")], {
    stdio: ["pipe", "pipe", "pipe"],
    shell: false,
  });
  try {
    const client = lineClient(child);
    const init = await client.request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "probe", version: "1" },
    });
    assert(init.result?.protocolVersion === "2025-06-18", "initialize 未返回预期协议版本");
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);

    const list = await client.request("tools/list", {});
    assert(Array.isArray(list.result?.tools), "tools/list 未返回 tools 数组");
    assert(list.result.tools.length === 5, `tools/list 数量异常: ${list.result.tools.length}`);

    const call = await client.request("tools/call", { name: "echo", arguments: { text: "hello" } });
    assert(call.result?.content?.[0]?.text === "hello", "tools/call 回显结果不符");

    return { tools: list.result.tools.length, echo: call.result.content[0].text };
  } finally {
    child.kill();
  }
}

async function probeHttp() {
  /** 单请求 JSON-RPC 服务，模拟 Streamable HTTP 的 JSON 响应分支。 */
  const server = createServer((req, res) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      const message = JSON.parse(body || "{}");
      const respond = (result) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
      };
      if (message.method === "initialize") {
        respond({
          protocolVersion: "2025-06-18",
          capabilities: { tools: {} },
          serverInfo: { name: "probe-http", version: "1" },
        });
        return;
      }
      if (message.method === "tools/list") {
        respond({ tools: [{ name: "echo", inputSchema: { type: "object" } }] });
        return;
      }
      if (message.method === "tools/call") {
        respond({ content: [{ type: "text", text: "http-ok" }] });
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: {} }));
    });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const url = `http://127.0.0.1:${port}/mcp`;

  const call = async (method, params) => {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": "2025-06-18",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    assert(response.ok, `HTTP ${method} 返回 ${response.status}`);
    return response.json();
  };

  try {
    const init = await call("initialize", { protocolVersion: "2025-06-18", capabilities: {} });
    assert(init.result?.protocolVersion === "2025-06-18", "HTTP initialize 结果异常");
    const list = await call("tools/list", {});
    assert(list.result?.tools?.length === 1, "HTTP tools/list 结果异常");
    const result = await call("tools/call", { name: "echo", arguments: {} });
    assert(result.result?.content?.[0]?.text === "http-ok", "HTTP tools/call 结果异常");
    return { url, tools: list.result.tools.length };
  } finally {
    server.close();
  }
}

const stdio = await probeStdio();
const http = await probeHttp();
console.log(JSON.stringify({ ok: true, node: process.version, stdio, http }, null, 2));
