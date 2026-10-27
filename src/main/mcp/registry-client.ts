import {
  mapRegistryServer,
  type RegistryRecord,
} from "@shared/mcp-registry";
import type { McpCatalogEntry } from "@shared/mcp-catalog";

/** 官方 MCP Registry 端点。固定值：不接受渲染层传入地址。 */
export const REGISTRY_ENDPOINT = "https://registry.modelcontextprotocol.io/v0/servers";

const PAGE_LIMIT = 100;
const TIMEOUT_MS = 8_000;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const MAX_QUERY_LENGTH = 200;

export type RegistrySearchResult = {
  entries: McpCatalogEntry[];
  /** 还有下一页时给出游标。 */
  nextCursor?: string;
};

export class RegistryError extends Error {
  readonly code: "TIMEOUT" | "NETWORK" | "HTTP" | "PARSE" | "LIMIT";

  constructor(code: RegistryError["code"], message: string) {
    super(message);
    this.name = "RegistryError";
    this.code = code;
  }
}

export type RegistryClientOptions = {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  endpoint?: string;
};

/**
 * 搜索官方 Registry。
 *
 * 只做一件事：请求固定端点、按游标分页、把记录映射成市场模板。
 * 网络错误统一抛 `RegistryError`，由 market 层转成 `remoteError` 文案。
 */
export async function searchRegistry(
  query: string,
  cursor?: string,
  options: RegistryClientOptions = {},
): Promise<RegistrySearchResult> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new RegistryError("NETWORK", "当前运行时不支持网络请求");
  }
  const endpoint = options.endpoint ?? REGISTRY_ENDPOINT;
  const params = new URLSearchParams({ version: "latest", limit: String(PAGE_LIMIT) });
  const trimmed = String(query ?? "").trim().slice(0, MAX_QUERY_LENGTH);
  if (trimmed) params.set("search", trimmed);
  if (cursor) params.set("cursor", cursor);

  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new RegistryError("NETWORK", "Registry 地址无效");
  }
  if (url.protocol !== "https:") {
    throw new RegistryError("NETWORK", "Registry 只允许 https");
  }
  for (const [key, value] of params) url.searchParams.set(key, value);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetchImpl(url.toString(), {
      method: "GET",
      headers: {
        accept: "application/json",
        "user-agent": "Pi-Desktop-MCP-Market/1",
      },
      redirect: "error",
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new RegistryError("TIMEOUT", "Registry 请求超时（8 秒）");
    }
    throw new RegistryError("NETWORK", `无法连接 Registry：${(error as Error)?.message ?? error}`);
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    try {
      await response.body?.cancel();
    } catch {
      // 状态码已足够构造错误
    }
    throw new RegistryError("HTTP", `Registry 返回 ${response.status}`);
  }

  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
    try {
      await response.body?.cancel();
    } catch {
      // 忽略取消失败
    }
    throw new RegistryError("LIMIT", "Registry 响应过大");
  }

  let body: string;
  try {
    body = await response.text();
  } catch (error) {
    throw new RegistryError("NETWORK", `读取 Registry 响应失败：${(error as Error)?.message ?? error}`);
  }
  if (body.length > MAX_RESPONSE_BYTES) {
    throw new RegistryError("LIMIT", "Registry 响应过大");
  }

  let parsed: { servers?: RegistryRecord[]; metadata?: { nextCursor?: string } };
  try {
    parsed = JSON.parse(body) as typeof parsed;
  } catch {
    throw new RegistryError("PARSE", "Registry 返回的不是合法 JSON");
  }

  const entries: McpCatalogEntry[] = [];
  const seen = new Set<string>();
  for (const record of Array.isArray(parsed.servers) ? parsed.servers : []) {
    const entry = mapRegistryServer(record);
    if (!entry || seen.has(entry.id)) continue;
    seen.add(entry.id);
    entries.push(entry);
  }

  const next = typeof parsed.metadata?.nextCursor === "string" ? parsed.metadata.nextCursor : "";
  return {
    entries,
    ...(next && next !== cursor ? { nextCursor: next } : {}),
  };
}
