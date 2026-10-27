import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { clearSessionIndexCache, listSessionsFast, sessionDirFor } from "../src/main/session-index.ts";

/** 造一个最小可用的会话文件：第一行是 session 头，其余是消息。 */
function sessionLines({ id, cwd, name, texts }) {
  const header = { type: "session", id, cwd, timestamp: "2026-10-01T00:00:00.000Z" };
  const lines = [JSON.stringify(header)];
  if (name) {
    lines.push(JSON.stringify({ type: "session_info", id: "info-1", name, timestamp: "2026-10-01T00:00:01.000Z" }));
  }
  texts.forEach((text, index) => {
    lines.push(
      JSON.stringify({
        type: "message",
        id: `m${index}`,
        timestamp: `2026-10-01T00:00:0${index + 2}.000Z`,
        message: {
          role: index % 2 === 0 ? "user" : "assistant",
          content: [{ type: "text", text }],
          timestamp: Date.parse(`2026-10-01T00:00:0${index + 2}.000Z`),
        },
      }),
    );
  });
  return lines.join("\n");
}

function setup() {
  const root = mkdtempSync(join(tmpdir(), "pi-session-index-"));
  const agentDir = join(root, "agent");
  const cwd = join(root, "project");
  const dir = sessionDirFor(cwd, agentDir);
  mkdirSync(dir, { recursive: true });
  return { root, agentDir, cwd, dir, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test("listSessionsFast 解析 header / messageCount / firstMessage / name", async () => {
  const ctx = setup();
  try {
    writeFileSync(
      join(ctx.dir, "a.jsonl"),
      sessionLines({ id: "sess-a", cwd: ctx.cwd, name: "重构会话列表", texts: ["第一条用户消息", "助手回复"] }),
    );
    writeFileSync(
      join(ctx.dir, "b.jsonl"),
      sessionLines({ id: "sess-b", cwd: ctx.cwd, texts: ["另一个会话"] }),
    );
    // 没有 session 头的文件应被忽略
    writeFileSync(join(ctx.dir, "c.jsonl"), JSON.stringify({ type: "message", id: "x" }));
    // 非 jsonl 文件忽略
    writeFileSync(join(ctx.dir, "notes.txt"), "ignore me");

    clearSessionIndexCache();
    const sessions = await listSessionsFast(ctx.cwd, ctx.agentDir);
    assert.equal(sessions.length, 2, "只应返回两个有效会话");
    const a = sessions.find((item) => item.id === "sess-a");
    assert.ok(a);
    assert.equal(a.name, "重构会话列表");
    assert.equal(a.firstMessage, "第一条用户消息");
    assert.equal(a.messageCount, 2);
    assert.equal(a.cwd, ctx.cwd);
    assert.equal(a.created, "2026-10-01T00:00:00.000Z");
    // modified 取最后一条消息的活动时间
    assert.equal(a.modified, "2026-10-01T00:00:03.000Z");
    // sess-a 的 last activity 更晚（00:00:03 > 00:00:02），应排在最前
    assert.equal(sessions[0].id, "sess-a", "按 modified 倒序");
  } finally {
    ctx.cleanup();
  }
});

test("listSessionsFast 复用缓存，只在文件变化时重解析", async () => {
  const ctx = setup();
  try {
    writeFileSync(join(ctx.dir, "a.jsonl"), sessionLines({ id: "sess-a", cwd: ctx.cwd, texts: ["hi"] }));
    clearSessionIndexCache();

    const first = await listSessionsFast(ctx.cwd, ctx.agentDir);
    assert.equal(first[0].messageCount, 1);

    // 无变化：结果一致（命中缓存）
    const cached = await listSessionsFast(ctx.cwd, ctx.agentDir);
    assert.deepEqual(cached, first);

    // 追加一条消息：size/mtime 变化 → 重新解析
    appendFileSync(
      join(ctx.dir, "a.jsonl"),
      `\n${JSON.stringify({
        type: "message",
        id: "m-appended",
        timestamp: "2026-10-01T00:05:00.000Z",
        message: { role: "user", content: [{ type: "text", text: "新增的一条" }], timestamp: Date.parse("2026-10-01T00:05:00.000Z") },
      })}`,
    );
    const appended = await listSessionsFast(ctx.cwd, ctx.agentDir);
    assert.equal(appended[0].messageCount, 2);
    assert.equal(appended[0].modified, "2026-10-01T00:05:00.000Z");
  } finally {
    ctx.cleanup();
  }
});

test("listSessionsFast 删除会话后缓存同步淘汰", async () => {
  const ctx = setup();
  try {
    writeFileSync(join(ctx.dir, "a.jsonl"), sessionLines({ id: "sess-a", cwd: ctx.cwd, texts: ["a"] }));
    writeFileSync(join(ctx.dir, "b.jsonl"), sessionLines({ id: "sess-b", cwd: ctx.cwd, texts: ["b"] }));
    clearSessionIndexCache();
    assert.equal((await listSessionsFast(ctx.cwd, ctx.agentDir)).length, 2);

    rmSync(join(ctx.dir, "b.jsonl"));
    const sessions = await listSessionsFast(ctx.cwd, ctx.agentDir);
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].id, "sess-a");
  } finally {
    ctx.cleanup();
  }
});

test("listSessionsFast 目录不存在时返回空数组", async () => {
  const ctx = setup();
  try {
    clearSessionIndexCache();
    assert.deepEqual(await listSessionsFast(join(ctx.root, "nope"), ctx.agentDir), []);
  } finally {
    ctx.cleanup();
  }
});
