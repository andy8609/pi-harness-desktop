/**
 * T8 结果与错误归一化测试。
 *
 * 运行：npm run test:mcp
 */
import assert from "node:assert/strict";
import test from "node:test";
import { describeMcpToolError, normalizeMcpResult } from "../src/main/mcp/content.ts";

const meta = { serverId: "mock", toolName: "echo", transport: "stdio", durationMs: 12 };

test("文本结果与结构化结果", () => {
  const text = normalizeMcpResult({ content: [{ type: "text", text: "hello" }] }, meta);
  assert.deepEqual(text.content, [{ type: "text", text: "hello" }]);
  assert.equal(text.details.serverId, "mock");
  assert.equal(text.details.durationMs, 12);

  const structured = normalizeMcpResult(
    { content: [{ type: "text", text: "3" }], structuredContent: { sum: 3 } },
    meta,
  );
  assert.equal(structured.content.length, 2);
  assert.equal(structured.content[1].type, "text");
  assert.match(structured.content[1].text, /"sum": 3/);
  assert.match(structured.details.structuredContent, /"sum": 3/);
});

test("图片、资源与未知块", () => {
  const result = normalizeMcpResult(
    {
      content: [
        { type: "image", data: "aGVsbG8=", mimeType: "image/png" },
        { type: "resource", resource: { uri: "file:///a.txt", text: "file body" } },
        { type: "resource", resource: { uri: "file:///b.png", blob: "aGVsbG8=", mimeType: "image/png" } },
        { type: "resource", resource: { uri: "file:///c.bin", blob: "AAAA", mimeType: "application/octet-stream" } },
        { type: "audio", data: "x" },
        { type: "weird", value: 1 },
      ],
    },
    meta,
  );
  assert.equal(result.content[0].type, "image");
  assert.equal(result.content[0].mimeType, "image/png");
  assert.equal(result.content[1].text, "file body");
  assert.equal(result.content[2].type, "image");
  assert.match(result.content[3].text, /二进制资源/);
  assert.match(result.content[4].text, /音频/);
  assert.equal(result.details.droppedBlocks, 1);
});

test("空结果与纯字符串结果", () => {
  assert.equal(normalizeMcpResult(null, meta).content[0].text, "（MCP 工具没有返回内容）");
  assert.equal(normalizeMcpResult({ content: [] }, meta).content[0].text, "（MCP 工具没有返回内容）");
  assert.equal(normalizeMcpResult("plain", meta).content[0].text, "plain");
});

test("超长文本被截断并标记", () => {
  const long = "x".repeat(40 * 1024);
  const result = normalizeMcpResult({ content: [{ type: "text", text: long }] }, meta);
  assert.equal(result.details.truncated, true);
  assert.match(result.content[0].text, /结果已截断/);
  assert.ok(result.content[0].text.length < long.length);
});

test("错误归一化覆盖超时、不可用、工具失败、401 与未知错误", () => {
  assert.match(describeMcpToolError({ code: "TIMEOUT", message: "MCP tools/call 超时" }), /超时/);
  assert.match(describeMcpToolError({ code: "UNAVAILABLE", message: "未连接" }), /不可用/);
  assert.match(describeMcpToolError({ code: "TOOL_FAILED", message: "boom" }), /返回错误：boom/);
  assert.match(
    describeMcpToolError({ code: "HTTP_ERROR", message: "MCP 服务器返回 401" }),
    /Authorization/,
  );
  assert.match(describeMcpToolError({ code: "HTTP_ERROR", message: "MCP 服务器返回 500" }), /请求失败/);
  assert.match(describeMcpToolError(new Error("plain")), /调用失败：plain/);
});
