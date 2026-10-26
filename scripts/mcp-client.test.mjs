/**
 * T8 客户端传输与错误路径测试：HTTP JSON / SSE / 401 / 重定向 / 分页 / 超时 / 子进程崩溃。
 *
 * 运行：npm run test:mcp
 */
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { McpServerClient, resolveWindowsLauncher } from "../src/main/mcp/client.ts";

function jsonClient(url, overrides = {}) {
  return new McpServerClient({
    serverId: "remote",
    transport: "http",
    rootPath: process.cwd(),
    url,
    values: {},
    connectTimeoutMs: 2000,
    callTimeoutMs: 1000,
    ...overrides,
  });
}

/** 启动一次性 HTTP JSON-RPC 服务，测试结束自动关闭。 */
async function withServer(respond, run) {
  const server = createServer((req, res) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      const message = JSON.parse(body || "{}");
      const reply = (result) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
      };
      respond({ message, req, res, reply });
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}/mcp`;
  try {
    return await run(url, server);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("HTTP JSON：initialize、tools/list、tools/call", async () => {
  await withServer(
    ({ message, reply }) => {
      if (message.method === "initialize") {
        reply({ protocolVersion: "2025-06-18", capabilities: { tools: {} } });
      } else if (message.method === "tools/list") {
        reply({ tools: [{ name: "echo", description: "回显", inputSchema: { type: "object" } }] });
      } else {
        reply({ content: [{ type: "text", text: "http-ok" }] });
      }
    },
    async (url) => {
      const client = jsonClient(url);
      const tools = await client.connect();
      assert.equal(tools.length, 1);
      assert.equal(client.isConnected(), true);
      const result = await client.callTool("echo", { text: "x" });
      assert.equal(result.content[0].text, "http-ok");
      client.close();
      assert.equal(client.isConnected(), false);
    },
  );
});

test("HTTP SSE：从 text/event-stream 响应中解析 JSON-RPC", async () => {
  await withServer(
    ({ message, res }) => {
      const payload =
        message.method === "initialize"
          ? { protocolVersion: "2025-06-18", capabilities: {} }
          : message.method === "tools/list"
            ? { tools: [{ name: "sse_tool" }] }
            : { content: [{ type: "text", text: "sse-ok" }] };
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: message.id, result: payload })}\n\n`);
    },
    async (url) => {
      const client = jsonClient(url);
      const tools = await client.connect();
      assert.deepEqual(tools.map((tool) => tool.name), ["sse_tool"]);
      const result = await client.callTool("sse_tool", {});
      assert.equal(result.content[0].text, "sse-ok");
      client.close();
    },
  );
});

test("HTTP 401：连接失败且错误信息带状态码", async () => {
  await withServer(
    ({ res }) => {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "unauthorized" }));
    },
    async (url) => {
      const client = jsonClient(url);
      await assert.rejects(() => client.connect(), /401/);
      assert.equal(client.isConnected(), false);
    },
  );
});

test("HTTP 重定向：跨 origin 丢弃自定义 header，超过上限报错", async () => {
  const seen = [];
  await withServer(
    ({ message, req, res, reply }) => {
      seen.push({ url: req.url, auth: req.headers.authorization });
      if (req.url === "/mcp") {
        res.writeHead(302, { location: "/next" });
        res.end();
        return;
      }
      if (req.url === "/next") {
        res.writeHead(302, { location: "/loop" });
        res.end();
        return;
      }
      if (req.url === "/loop") {
        res.writeHead(302, { location: "/loop" });
        res.end();
        return;
      }
      if (message.method === "initialize") {
        reply({ protocolVersion: "2025-06-18", capabilities: {} });
      } else {
        reply({ tools: [] });
      }
    },
    async (url) => {
      const client = jsonClient(url, { values: { Authorization: "Bearer secret" } });
      // 同 origin 重定向保留 header；无限重定向在 5 跳后失败
      await assert.rejects(() => client.connect(), /重定向次数过多/);
      assert.equal(seen[0].auth, "Bearer secret");
      assert.equal(seen[0].url, "/mcp");
    },
  );
});

test("tools/list 分页与单服务器上限", async () => {
  await withServer(
    ({ message, reply }) => {
      if (message.method === "initialize") {
        reply({ protocolVersion: "2025-06-18", capabilities: {} });
        return;
      }
      if (message.method === "tools/list") {
        if (!message.params?.cursor) {
          reply({ tools: [{ name: "a" }], nextCursor: "p2" });
          return;
        }
        if (message.params.cursor === "p2") {
          reply({ tools: [{ name: "b" }, { name: "c" }] });
          return;
        }
      }
      reply({});
    },
    async (url) => {
      const client = jsonClient(url);
      const tools = await client.connect();
      assert.deepEqual(tools.map((tool) => tool.name), ["a", "b", "c"]);
      client.close();
    },
  );

  await withServer(
    ({ message, reply }) => {
      if (message.method === "initialize") {
        reply({ protocolVersion: "2025-06-18", capabilities: {} });
      } else if (message.method === "tools/list") {
        reply({ tools: Array.from({ length: 70 }, (_, index) => ({ name: `t${index}` })) });
      } else {
        reply({});
      }
    },
    async (url) => {
      const audits = [];
      const client = jsonClient(url, { audit: (entry) => audits.push(entry) });
      const tools = await client.connect();
      assert.equal(tools.length, 64);
      assert.ok(audits.some((entry) => entry.api === "mcp.tools.truncated"));
      client.close();
    },
  );
});

test("连接超时：服务器不响应时抛 TIMEOUT", async () => {
  await withServer(
    () => {
      // 故意不响应
    },
    async (url) => {
      const client = jsonClient(url, { connectTimeoutMs: 250 });
      await assert.rejects(
        () => client.connect(),
        (error) => error.code === "TIMEOUT" && /超时/.test(error.message),
      );
    },
  );
});

test("Windows：npx 这类 .cmd 通过 cmd.exe 包装，.exe 不包装", { skip: process.platform !== "win32" }, () => {
  const launcher = resolveWindowsLauncher("npx", ["-y", "@upstash/context7-mcp"]);
  assert.match(launcher.command, /cmd(\.exe)?$/i);
  assert.equal(launcher.viaCmd, true);
  assert.deepEqual(launcher.args.slice(0, 3), ["/d", "/s", "/c"]);
  assert.match(launcher.args[3], /npx\.cmd/i);
  assert.match(launcher.args[3], /@upstash\/context7-mcp/);
  assert.ok(launcher.args[3].startsWith('"') && launcher.args[3].endsWith('"'));

  const direct = resolveWindowsLauncher(process.execPath, ["--version"]);
  assert.equal(direct.viaCmd, false);
  assert.equal(direct.command, process.execPath);
});

test("Windows：绝对路径含空格的 .cmd 也能启动 MCP 服务器", { skip: process.platform !== "win32" }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "pi mcp shim "));
  const shim = join(dir, "run server.cmd");
  writeFileSync(
    shim,
    `@echo off
"${process.execPath}" "${join(process.cwd(), "scripts", "mock-mcp-server.mjs")}" %*
`,
    "utf8",
  );
  const client = new McpServerClient({
    serverId: "shim",
    transport: "stdio",
    rootPath: process.cwd(),
    command: shim,
    args: [],
    values: {},
    connectTimeoutMs: 10_000,
  });
  const tools = await client.connect();
  assert.equal(tools.length, 5);
  const result = await client.callTool("echo", { text: "shim-ok" });
  assert.equal(result.content[0].text, "shim-ok");
  client.close();
});

test("stdio 子进程崩溃：连接失败而不是挂起", async () => {
  const client = new McpServerClient({
    serverId: "crash",
    transport: "stdio",
    rootPath: process.cwd(),
    command: process.execPath,
    args: ["-e", "process.exit(1)"],
    values: {},
    connectTimeoutMs: 2000,
  });
  await assert.rejects(() => client.connect());
  assert.equal(client.isConnected(), false);
});
