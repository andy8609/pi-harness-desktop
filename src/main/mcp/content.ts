/**
 * MCP `tools/call` 结果的归一化。
 *
 * 纯函数、零项目内依赖（Node 测试直接加载）。输入是 MCP 原始 result，
 * 输出是 pi SDK 需要的 `{ content, details }` 形状。
 */

export type McpResultBlock =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

export interface McpResultMeta {
  serverId: string;
  toolName: string;
  transport: "stdio" | "http";
  durationMs: number;
}

export interface NormalizedMcpResult {
  content: McpResultBlock[];
  details: {
    serverId: string;
    toolName: string;
    transport: "stdio" | "http";
    durationMs: number;
    /** 结构化结果的 JSON 文本（已截断），供 UI 折叠展示。 */
    structuredContent?: string;
    /** 被丢弃的未知块数量。 */
    droppedBlocks?: number;
    /** 文本是否被截断。 */
    truncated?: boolean;
  };
}

/** 结果文本上限：超过后截断，避免一次工具调用撑爆上下文。 */
export const MCP_RESULT_TEXT_LIMIT = 32 * 1024;

const EMPTY_RESULT = "（MCP 工具没有返回内容）";

/**
 * 把 MCP 结果转成 SDK 内容块。
 *
 * - `text` / `resource.text` → text
 * - `image` / 图片型 `resource.blob` → image（base64 原样透传）
 * - `structuredContent` → 追加一段 JSON 文本，并写入 details
 * - 未知块丢弃并计数，不让一个畸形块毁掉整次调用
 */
export function normalizeMcpResult(raw: unknown, meta: McpResultMeta): NormalizedMcpResult {
  const details: NormalizedMcpResult["details"] = {
    serverId: meta.serverId,
    toolName: meta.toolName,
    transport: meta.transport,
    durationMs: meta.durationMs,
  };

  if (raw === null || raw === undefined) {
    return { content: [{ type: "text", text: EMPTY_RESULT }], details };
  }
  if (typeof raw === "string") {
    const { text, truncated } = truncateText(raw);
    if (truncated) details.truncated = true;
    return { content: [{ type: "text", text: text || EMPTY_RESULT }], details };
  }
  if (typeof raw !== "object") {
    const { text, truncated } = truncateText(String(raw));
    if (truncated) details.truncated = true;
    return { content: [{ type: "text", text }], details };
  }

  const record = raw as { content?: unknown; structuredContent?: unknown };
  const blocks = Array.isArray(record.content) ? record.content : [];
  const content: McpResultBlock[] = [];
  let dropped = 0;
  let truncated = false;

  for (const block of blocks) {
    const converted = convertBlock(block);
    if (!converted) {
      dropped += 1;
      continue;
    }
    content.push(converted.block);
    if (converted.truncated) truncated = true;
  }

  if (record.structuredContent !== undefined && record.structuredContent !== null) {
    const json = safeJson(record.structuredContent);
    if (json) {
      const { text, truncated } = truncateText(json);
      if (truncated) details.truncated = true;
      details.structuredContent = text;
      content.push({ type: "text", text });
    }
  }

  if (dropped > 0) details.droppedBlocks = dropped;
  if (truncated) details.truncated = true;
  if (content.length === 0) content.push({ type: "text", text: EMPTY_RESULT });
  return { content, details };
}

type ConvertedBlock = { block: McpResultBlock; truncated?: boolean };

function convertBlock(block: unknown): ConvertedBlock | undefined {
  if (!block || typeof block !== "object") return undefined;
  const candidate = block as {
    type?: unknown;
    text?: unknown;
    data?: unknown;
    mimeType?: unknown;
    resource?: unknown;
  };

  if (candidate.type === "text" && typeof candidate.text === "string") {
    const { text, truncated } = truncateText(candidate.text);
    return { block: { type: "text", text }, truncated };
  }
  if (
    candidate.type === "image" &&
    typeof candidate.data === "string" &&
    typeof candidate.mimeType === "string"
  ) {
    return { block: { type: "image", data: candidate.data, mimeType: candidate.mimeType } };
  }
  if (candidate.type === "resource" && candidate.resource && typeof candidate.resource === "object") {
    const resource = candidate.resource as {
      uri?: unknown;
      text?: unknown;
      blob?: unknown;
      mimeType?: unknown;
    };
    const uri = typeof resource.uri === "string" ? resource.uri : "";
    if (typeof resource.text === "string") {
      const { text, truncated } = truncateText(resource.text);
      return { block: { type: "text", text }, truncated };
    }
    const mime = typeof resource.mimeType === "string" ? resource.mimeType : "";
    if (typeof resource.blob === "string" && mime.startsWith("image/")) {
      return { block: { type: "image", data: resource.blob, mimeType: mime } };
    }
    if (typeof resource.blob === "string") {
      return { block: { type: "text", text: `[二进制资源${uri ? `：${uri}` : ""}（${mime || "未知类型"}）]` } };
    }
    return undefined;
  }
  if (candidate.type === "audio") {
    return { block: { type: "text", text: "[音频内容暂不支持直接展示]" } };
  }
  return undefined;
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? "";
  } catch {
    return "";
  }
}

function truncateText(text: string): { text: string; truncated: boolean } {
  if (text.length <= MCP_RESULT_TEXT_LIMIT) return { text, truncated: false };
  return {
    text: `${text.slice(0, MCP_RESULT_TEXT_LIMIT)}\n…（结果已截断，原始长度 ${text.length} 字符）`,
    truncated: true,
  };
}

/**
 * 把调用链路的异常转成用户能读懂的提示。
 *
 * 错误码来自 `client.ts` 的 McpError，但这里只用结构化判断，保持零依赖。
 */
export function describeMcpToolError(error: unknown): string {
  const candidate = error as { code?: unknown; message?: unknown } | null;
  const code = typeof candidate?.code === "string" ? candidate.code : "";
  const message =
    typeof candidate?.message === "string" && candidate.message
      ? candidate.message
      : String(error ?? "未知错误");

  switch (code) {
    case "TIMEOUT":
      return `MCP 工具执行超时：${message}`;
    case "UNAVAILABLE":
      return `MCP 服务器不可用：${message}`;
    case "TOOL_FAILED":
      return `MCP 工具返回错误：${message}`;
    case "TOOL_NOT_FOUND":
    case "TOOL_DISABLED":
      return message;
    case "HTTP_ERROR":
      if (/\b401\b|\b403\b/.test(message)) {
        return `MCP 服务器要求授权（${message}）：请在服务器配置的 headers 中填写 Authorization`;
      }
      return `MCP 服务器请求失败：${message}`;
    case "LIMIT_EXCEEDED":
      return `MCP 返回内容超出上限：${message}`;
    case "MCP_ERROR":
      return `MCP 协议错误：${message}`;
    default:
      return `MCP 工具调用失败：${message}`;
  }
}
