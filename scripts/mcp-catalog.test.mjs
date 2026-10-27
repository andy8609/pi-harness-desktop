/**
 * T4 市场模板引擎测试。
 *
 * 运行：npm run test:mcp
 */
import assert from "node:assert/strict";
import test from "node:test";
import { BUILTIN_MCP_CATALOG } from "../src/shared/mcp-catalog-builtin.ts";
import { normalizeMcpServerInput } from "../src/shared/mcp.ts";
import {
  catalogEntryError,
  collectCatalogPlaceholders,
  isSafeHttpsUrl,
  matchesCatalogQuery,
  resolveCatalogEntry,
  validateMcpCatalogFile,
} from "../src/shared/mcp-catalog.ts";

const filesystem = {
  id: "filesystem",
  name: "Filesystem",
  transport: "stdio",
  command: "npx",
  args: ["-y", "@modelcontextprotocol/server-filesystem", "${MCP_FS_ROOT}"],
  requiredEnv: [{ name: "MCP_FS_ROOT", description: "根目录", defaultValue: "." }],
};

test("占位符收集与模板渲染", () => {
  assert.deepEqual(collectCatalogPlaceholders(filesystem), ["MCP_FS_ROOT"]);
  const input = resolveCatalogEntry(filesystem, { MCP_FS_ROOT: "D:/work" });
  assert.equal(input.id, "filesystem");
  assert.equal(input.transport, "stdio");
  assert.deepEqual(input.args, ["-y", "@modelcontextprotocol/server-filesystem", "D:/work"]);

  // 未提供值时用 defaultValue
  const withDefault = resolveCatalogEntry(filesystem, {});
  assert.equal(withDefault.args.at(-1), ".");
});

test("缺失必填值与未声明占位符被拒绝", () => {
  const required = { ...filesystem, requiredEnv: [{ name: "MCP_FS_ROOT" }] };
  assert.throws(() => resolveCatalogEntry(required, {}), /缺少 MCP_FS_ROOT 的值/);

  const undeclared = { ...filesystem, requiredEnv: [] };
  assert.match(catalogEntryError(undeclared), /占位符 MCP_FS_ROOT 未在 requiredEnv 中声明/);
});

test("optional 值为空时整条 env/header 被丢弃", () => {
  const entry = {
    id: "optional-demo",
    name: "Optional",
    transport: "stdio",
    command: "npx",
    args: ["-y", "demo"],
    env: { OPTIONAL_KEY: "${OPTIONAL_KEY}", LOG_LEVEL: "info" },
    requiredEnv: [{ name: "OPTIONAL_KEY", optional: true }],
  };
  const input = resolveCatalogEntry(entry, {});
  assert.deepEqual(input.env, { LOG_LEVEL: "info" });
  const filled = resolveCatalogEntry(entry, { OPTIONAL_KEY: "secret" });
  assert.equal(filled.env.OPTIONAL_KEY, "secret");
});

test("http 模板必须是公网 https，header 占位符正常替换", () => {
  const github = {
    id: "github",
    name: "GitHub",
    transport: "http",
    url: "https://api.githubcopilot.com/mcp/",
    headers: { Authorization: "Bearer ${GITHUB_PAT}" },
    requiredEnv: [{ name: "GITHUB_PAT" }],
  };
  const input = resolveCatalogEntry(github, { GITHUB_PAT: "token" });
  assert.equal(input.transport, "http");
  assert.equal(input.headers.Authorization, "Bearer token");

  assert.match(catalogEntryError({ ...github, url: "http://example.com/mcp" }), /公网 https/);
  assert.match(catalogEntryError({ ...github, url: "https://localhost/mcp" }), /公网 https/);
  assert.match(catalogEntryError({ ...github, url: "https://192.168.1.5/mcp" }), /公网 https/);
  assert.equal(isSafeHttpsUrl("https://mcp.example.com/mcp"), true);
  assert.equal(isSafeHttpsUrl("ftp://example.com/mcp"), false);
});

test("stdio 命令校验与搜索匹配", () => {
  assert.match(catalogEntryError({ ...filesystem, command: "../bin/node" }), /不能包含 \.\./);
  assert.match(catalogEntryError({ ...filesystem, command: "" }), /必须填写 command/);

  assert.equal(matchesCatalogQuery(filesystem, "file"), true);
  assert.equal(matchesCatalogQuery({ ...filesystem, categories: ["data"] }, "data"), true);
  assert.equal(matchesCatalogQuery(filesystem, "react"), false);
  assert.equal(matchesCatalogQuery(filesystem, "  "), true);
});

test("目录文件宽松解析：坏条目变成警告", () => {
  const { catalog, warnings } = validateMcpCatalogFile({
    updatedAt: "2026-01-01",
    servers: [
      filesystem,
      { ...filesystem }, // 重复 id
      { id: "Bad Id", name: "x", transport: "stdio", command: "x" },
      { id: "http-ok", name: "HTTP", transport: "http", url: "https://mcp.example.com/mcp" },
    ],
  });
  assert.deepEqual(
    catalog.servers.map((server) => server.id),
    ["filesystem", "http-ok"],
  );
  assert.equal(warnings.length, 2);
});

test("内置目录：条目完整、可安装、传输方式覆盖两类", () => {
  const servers = BUILTIN_MCP_CATALOG.servers;
  assert.ok(servers.length >= 10, `内置条目应 ≥10，实际 ${servers.length}`);
  assert.equal(new Set(servers.map((entry) => entry.id)).size, servers.length, "id 不应重复");
  assert.ok(servers.some((entry) => entry.transport === "stdio"));
  assert.ok(servers.some((entry) => entry.transport === "http"));
  assert.ok(new Set(servers.flatMap((entry) => entry.categories ?? [])).size >= 3);

  for (const entry of servers) {
    assert.equal(catalogEntryError(entry), null, `${entry.id} 模板校验失败`);
    const values = Object.fromEntries(
      (entry.requiredEnv ?? []).map((spec) => [spec.name, spec.defaultValue ?? "test-value"]),
    );
    const input = resolveCatalogEntry(entry, values);
    const normalized = normalizeMcpServerInput(input, { now: new Date().toISOString() });
    assert.equal(normalized.ok, true, `${entry.id} 生成配置不合法: ${normalized.ok ? "" : normalized.error}`);
  }

  const context7 = servers.find((entry) => entry.id === "context7");
  assert.ok(context7);
  assert.equal(context7.command, "npx");
  assert.deepEqual(context7.args, ["-y", "@upstash/context7-mcp"]);
});
