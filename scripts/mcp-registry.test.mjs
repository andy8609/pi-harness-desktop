/**
 * T6 Registry 映射测试（纯函数）。
 *
 * 运行：npm run test:mcp
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  argumentValues,
  guessCategory,
  mapRegistryServer,
  mergeRegistryEntries,
  registryIdFromName,
} from "../src/shared/mcp-registry.ts";

test("registryIdFromName 生成合法 id", () => {
  assert.equal(registryIdFromName("com.pulsemcp/foo"), "com-pulsemcp-foo");
  assert.equal(registryIdFromName("io.github/Some_Repo"), "io-github-some_repo");
  assert.equal(registryIdFromName("123"), "mcp-123");
  assert.equal(registryIdFromName(""), "mcp-server");
  assert.ok(registryIdFromName("a".repeat(200)).length <= 64);
});

test("npm 包映射：命令、参数顺序、环境变量模板", () => {
  const entry = mapRegistryServer({
    server: {
      name: "io.example/search",
      title: "Example Search",
      description: "Search things",
      packages: [
        {
          registryType: "npm",
          identifier: "@example/mcp-search",
          version: "1.2.3",
          runtimeHint: "npx",
          runtimeArguments: [{ type: "positional", value: "-y" }],
          packageArguments: [{ type: "named", name: "--limit", value: "10" }],
          environmentVariables: [
            { name: "EXAMPLE_KEY", isRequired: true, description: "API key" },
            { name: "EXAMPLE_REGION", default: "us" },
          ],
        },
      ],
    },
  });
  assert.ok(entry);
  assert.equal(entry.transport, "stdio");
  assert.equal(entry.command, "npx");
  assert.deepEqual(entry.args, ["-y", "@example/mcp-search@1.2.3", "--limit", "10"]);
  assert.deepEqual(entry.env, {
    EXAMPLE_KEY: "${EXAMPLE_KEY}",
    EXAMPLE_REGION: "${EXAMPLE_REGION}",
  });
  assert.deepEqual(entry.requiredEnv, [
    { name: "EXAMPLE_KEY", description: "API key" },
    { name: "EXAMPLE_REGION", optional: true, defaultValue: "us" },
  ]);
});

test("pypi 包映射：uvx 与前置条件", () => {
  const entry = mapRegistryServer({
    server: {
      name: "example/time",
      packages: [
        {
          registryType: "pypi",
          identifier: "mcp-server-time",
          version: "0.1.0",
        },
      ],
    },
  });
  assert.ok(entry);
  assert.equal(entry.command, "uvx");
  assert.deepEqual(entry.args, ["mcp-server-time==0.1.0"]);
  assert.deepEqual(entry.prerequisites, ["需要本机已安装 uv / uvx"]);
});

test("remote 映射：仅 streamable-http + 公网 https，header 占位符转 requiredEnv", () => {
  const entry = mapRegistryServer({
    server: {
      name: "example/remote",
      remotes: [
        {
          type: "streamable-http",
          url: "https://mcp.example.com/mcp",
          headers: [{ name: "Authorization", value: "Bearer ${EXAMPLE_TOKEN}" }],
        },
      ],
    },
  });
  assert.ok(entry);
  assert.equal(entry.transport, "http");
  assert.equal(entry.url, "https://mcp.example.com/mcp");
  assert.deepEqual(entry.headers, { Authorization: "Bearer ${EXAMPLE_TOKEN}" });
  assert.deepEqual(entry.requiredEnv, [{ name: "EXAMPLE_TOKEN" }]);

  assert.equal(
    mapRegistryServer({
      server: {
        name: "example/insecure",
        remotes: [{ type: "streamable-http", url: "http://mcp.example.com/mcp" }],
      },
    }),
    null,
  );
  assert.equal(
    mapRegistryServer({
      server: {
        name: "example/sse",
        remotes: [{ type: "sse", url: "https://mcp.example.com/sse" }],
      },
    }),
    null,
  );
});

test("不可运行或缺少 name 的记录返回 null", () => {
  assert.equal(mapRegistryServer({}), null);
  assert.equal(mapRegistryServer({ server: {} }), null);
  assert.equal(
    mapRegistryServer({
      server: {
        name: "example/oci-only",
        packages: [{ registryType: "oci", identifier: "ghcr.io/example/mcp" }],
      },
    }),
    null,
  );
});

test("参数、分类与合并", () => {
  assert.deepEqual(
    argumentValues([
      { type: "positional", value: "a" },
      { type: "named", name: "--x", value: "1" },
      { name: "--y" },
      { value: "" },
    ]),
    ["a", "--x", "1", "--y"],
  );

  assert.equal(guessCategory({ name: "github-mcp" }), "devtools");
  assert.equal(guessCategory({ description: "Postgres database tools" }), "data");
  assert.equal(guessCategory({ title: "Brave search" }), "web");
  assert.equal(guessCategory({ description: "Docs and reference" }), "docs");
  assert.equal(guessCategory({}), "devtools");

  const merged = mergeRegistryEntries(
    [{ id: "a", name: "A", transport: "stdio", command: "npx" }],
    [
      { id: "a", name: "A remote", transport: "http", url: "https://x.example.com/mcp" },
      { id: "b", name: "B", transport: "http", url: "https://y.example.com/mcp" },
    ],
  );
  assert.deepEqual(merged.map((entry) => entry.id), ["a", "b"]);
  assert.equal(merged[0].name, "A");
});
