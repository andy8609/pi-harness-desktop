/**
 * T7 Registry 网络客户端与市场合并/安装测试。
 *
 * 运行：npm run test:mcp
 */
import assert from "node:assert/strict";
import test from "node:test";
import { McpMarket } from "../src/main/mcp/market.ts";
import { RegistryError, searchRegistry } from "../src/main/mcp/registry-client.ts";
import { BUILTIN_MCP_CATALOG } from "../src/shared/mcp-catalog-builtin.ts";

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

const sampleRecord = {
  server: {
    name: "io.example/demo",
    title: "Demo Server",
    description: "A demo MCP server",
    packages: [{ registryType: "npm", identifier: "@example/demo-mcp", version: "1.0.0" }],
  },
};

test("Registry 客户端：成功解析条目与游标", async () => {
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(String(url));
    return jsonResponse({ servers: [sampleRecord], metadata: { nextCursor: "page-2" } });
  };
  const result = await searchRegistry("demo", undefined, { fetchImpl });
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].id, "io-example-demo");
  assert.equal(result.nextCursor, "page-2");
  assert.match(urls[0], /version=latest/);
  assert.match(urls[0], /limit=100/);
  assert.match(urls[0], /search=demo/);
  assert.ok(urls[0].startsWith("https://registry.modelcontextprotocol.io/v0/servers"));
});

test("Registry 客户端：非 2xx、坏 JSON、超大响应、超时", async () => {
  await assert.rejects(
    () => searchRegistry("", undefined, { fetchImpl: async () => new Response("nope", { status: 503 }) }),
    (error) => error instanceof RegistryError && error.code === "HTTP",
  );

  await assert.rejects(
    () => searchRegistry("", undefined, { fetchImpl: async () => new Response("{ not json") }),
    (error) => error instanceof RegistryError && error.code === "PARSE",
  );

  await assert.rejects(
    () =>
      searchRegistry("", undefined, {
        fetchImpl: async () =>
          new Response("x", { headers: { "content-length": String(5 * 1024 * 1024) } }),
      }),
    (error) => error instanceof RegistryError && error.code === "LIMIT",
  );

  const hangingFetch = (_url, init) =>
    new Promise((_, reject) => {
      init.signal.addEventListener("abort", () => reject(new Error("aborted")));
    });
  await assert.rejects(
    () => searchRegistry("", undefined, { fetchImpl: hangingFetch, timeoutMs: 50 }),
    (error) => error instanceof RegistryError && error.code === "TIMEOUT",
  );
});

test("Registry 客户端：跳过不可映射记录并去重", async () => {
  const fetchImpl = async () =>
    jsonResponse({
      servers: [
        sampleRecord,
        sampleRecord,
        { server: { name: "io.example/oci", packages: [{ registryType: "oci", identifier: "x" }] } },
        {},
      ],
    });
  const result = await searchRegistry("", undefined, { fetchImpl });
  assert.deepEqual(result.entries.map((entry) => entry.id), ["io-example-demo"]);
  assert.equal(result.nextCursor, undefined);
});

function fakeService() {
  const calls = [];
  return {
    calls,
    upsert: async (input) => {
      calls.push(input);
      return {
        server: { ...input, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
      };
    },
  };
}

test("市场搜索：内置始终可用，Registry 失败降级", async () => {
  const service = fakeService();
  const market = new McpMarket({
    service,
    registry: { fetchImpl: async () => new Response("down", { status: 500 }) },
  });
  const result = await market.search("context7");
  assert.deepEqual(result.entries.map((entry) => entry.id), ["context7"]);
  assert.equal(result.entries[0].source, "builtin");
  assert.match(result.remoteError, /Registry/);
});

test("市场搜索：内置优先去重，加载更多不重复内置", async () => {
  const service = fakeService();
  const fetchImpl = async () =>
    jsonResponse({
      servers: [
        {
          server: {
            name: "context7",
            title: "Context7 copy",
            packages: [{ registryType: "npm", identifier: "@upstash/context7-mcp" }],
          },
        },
        sampleRecord,
      ],
      metadata: { nextCursor: "next" },
    });
  const market = new McpMarket({ service, registry: { fetchImpl } });

  const first = await market.search("", undefined, false);
  const builtinCount = BUILTIN_MCP_CATALOG.servers.length;
  assert.equal(first.entries.length, builtinCount + 1);
  assert.equal(first.entries[0].source, "builtin");
  assert.equal(first.nextCursor, "next");

  const more = await market.search("", "next", true);
  assert.ok(more.entries.every((entry) => entry.source === "official"));
});

test("市场安装：模板 → upsert，缺值与非法模板被拒绝", async () => {
  const service = fakeService();
  const market = new McpMarket({ service, registry: { fetchImpl: async () => jsonResponse({ servers: [] }) } });

  const entry = {
    id: "filesystem",
    name: "Filesystem",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem", "${MCP_FS_ROOT}"],
    requiredEnv: [{ name: "MCP_FS_ROOT" }],
  };
  await assert.rejects(() => market.install(entry, {}), /缺少 MCP_FS_ROOT 的值/);
  assert.equal(service.calls.length, 0);

  const result = await market.install(entry, { MCP_FS_ROOT: "D:/work" });
  assert.equal(service.calls.length, 1);
  assert.equal(service.calls[0].id, "filesystem");
  assert.deepEqual(service.calls[0].args.at(-1), "D:/work");
  assert.equal(result.server.id, "filesystem");

  await assert.rejects(
    () => market.install({ ...entry, command: "../evil" }, { MCP_FS_ROOT: "x" }),
    /市场条目不可安装/,
  );
});
