/**
 * T5 配置数据层测试：`src/main/mcp/store.ts` + `src/shared/mcp.ts` 校验规则。
 *
 * 运行：npm run test:mcp
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { McpStore } from "../src/main/mcp/store.ts";
import { isServerActiveForProject, mcpToolName, normalizeMcpServerInput } from "../src/shared/mcp.ts";

function tempStore() {
  const dir = mkdtempSync(join(tmpdir(), "pi-mcp-store-"));
  const filePath = join(dir, "mcp-servers.json");
  return { dir, filePath, store: new McpStore({ filePath }) };
}

const stdioInput = {
  id: "filesystem",
  label: "Filesystem",
  description: "本地文件",
  transport: "stdio",
  command: "npx",
  args: ["-y", "@modelcontextprotocol/server-filesystem", "D:/work"],
  env: { LOG_LEVEL: "info" },
};

test("正常配置读写往返一致", () => {
  const { filePath, store } = tempStore();
  const saved = store.upsert(stdioInput);
  assert.equal(saved.id, "filesystem");
  assert.equal(saved.enabled, true);
  assert.deepEqual(saved.args, stdioInput.args);
  assert.deepEqual(saved.env, stdioInput.env);

  const reloaded = new McpStore({ filePath });
  const list = reloaded.list();
  assert.equal(list.length, 1);
  assert.deepEqual(list[0].args, stdioInput.args);
  assert.deepEqual(list[0].env, stdioInput.env);
  assert.equal(list[0].createdAt, saved.createdAt);

  const onDisk = JSON.parse(readFileSync(filePath, "utf8"));
  assert.equal(onDisk.version, 1);
  assert.equal(onDisk.servers.length, 1);
});

test("非法配置被拒绝且给出可读错误", () => {
  const cases = [
    [{ ...stdioInput, id: "1bad" }, /id 必须字母开头/],
    [{ ...stdioInput, command: "" }, /必须填写 command/],
    [{ ...stdioInput, command: "nvp/../bin/x" }, /不能包含/],
    [{ ...stdioInput, env: { "BAD-KEY": "x" } }, /不合法/],
    [{ ...stdioInput, args: Array.from({ length: 65 }, () => "x") }, /最多 64 项/],
    [{ ...stdioInput, transport: "http", url: "ftp://example.com/mcp" }, /只支持 http 或 https/],
    [{ ...stdioInput, transport: "http", url: "" }, /必须填写 url/],
  ];
  for (const [input, pattern] of cases) {
    const result = normalizeMcpServerInput(input, { now: new Date().toISOString() });
    assert.equal(result.ok, false, `应拒绝: ${JSON.stringify(input).slice(0, 80)}`);
    assert.match(result.error, pattern);
  }
  const { store } = tempStore();
  assert.throws(() => store.upsert({ ...stdioInput, id: "1bad" }), /id 必须字母开头/);
  assert.equal(store.list().length, 0);
});

test("重复 id 走更新而不是新增", () => {
  const { filePath, store } = tempStore();
  store.upsert(stdioInput);
  const updated = store.upsert({ ...stdioInput, label: "改名后", enabled: false });
  assert.equal(store.list().length, 1);
  assert.equal(updated.label, "改名后");
  assert.equal(updated.enabled, false);
  assert.equal(new McpStore({ filePath }).list().length, 1);
});

test("就地启停与工具级开关持久化", () => {
  const { filePath, store } = tempStore();
  store.upsert(stdioInput);
  assert.equal(store.setEnabled("filesystem", false).enabled, false);

  const withTool = store.setToolEnabled("filesystem", "write_file", false);
  assert.deepEqual(withTool.disabledTools, ["write_file"]);
  const enabledAgain = store.setToolEnabled("filesystem", "write_file", true);
  assert.deepEqual(enabledAgain.disabledTools ?? [], []);

  const reloaded = new McpStore({ filePath });
  assert.equal(reloaded.get("filesystem").enabled, false);
  assert.deepEqual(reloaded.get("filesystem").disabledTools ?? [], []);
  assert.throws(() => store.setEnabled("missing", true), /不存在/);
});

test("删除服务器", () => {
  const { store } = tempStore();
  store.upsert(stdioInput);
  assert.equal(store.remove("filesystem"), true);
  assert.equal(store.remove("filesystem"), false);
  assert.equal(store.list().length, 0);
});

test("配置文件损坏时备份并以空配置启动", () => {
  const { dir, filePath } = tempStore();
  writeFileSync(filePath, "{ not json", "utf8");
  const store = new McpStore({ filePath });
  assert.deepEqual(store.list(), []);
  const backups = readdirSync(dir).filter((name) => name.includes(".corrupt-"));
  assert.equal(backups.length, 1);
  assert.equal(readFileSync(join(dir, backups[0]), "utf8"), "{ not json");
});

test("加载时跳过非法与重复记录", () => {
  const { filePath } = tempStore();
  writeFileSync(
    filePath,
    JSON.stringify({
      version: 1,
      servers: [
        { ...stdioInput, createdAt: "2024-01-01T00:00:00.000Z", updatedAt: "2024-01-01T00:00:00.000Z" },
        { ...stdioInput, createdAt: "2024-01-01T00:00:00.000Z", updatedAt: "2024-01-01T00:00:00.000Z" },
        { id: "bad id", transport: "stdio", command: "x" },
        {
          id: "remote",
          label: "Remote",
          transport: "http",
          url: "https://example.com/mcp",
          headers: { Authorization: "Bearer t" },
          createdAt: "2024-01-01T00:00:00.000Z",
          updatedAt: "2024-01-01T00:00:00.000Z",
        },
      ],
    }),
    "utf8",
  );
  const store = new McpStore({ filePath });
  assert.deepEqual(
    store.list().map((server) => server.id),
    ["filesystem", "remote"],
  );
});

test("scope 与命名空间映射", () => {
  const project = { enabled: true, scope: { mode: "projects", projects: ["D:/work/a"] } };
  assert.equal(isServerActiveForProject(project, "D:\\work\\a\\"), true);
  assert.equal(isServerActiveForProject(project, "D:/work/b"), false);
  assert.equal(isServerActiveForProject({ enabled: false, scope: { mode: "global", projects: [] } }, "D:/x"), false);
  assert.equal(isServerActiveForProject({ enabled: true, scope: { mode: "global", projects: [] } }, null), true);

  assert.equal(mcpToolName("my-server", "read.file"), "mcp_my_server_read_file");
  assert.equal(mcpToolName("a_b", "c-d"), "mcp_a_b_c_d");
});
