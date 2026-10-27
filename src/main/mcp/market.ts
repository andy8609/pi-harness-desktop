import {
  catalogEntryError,
  matchesCatalogQuery,
  resolveCatalogEntry,
  type McpCatalogEntry,
  type McpMarketEntry,
  type McpMarketSearchResult,
} from "@shared/mcp-catalog";
import { BUILTIN_MCP_CATALOG } from "@shared/mcp-catalog-builtin";
import { RegistryError, searchRegistry, type RegistryClientOptions } from "./registry-client";
import type { McpService } from "./service";

export type McpMarketOptions = {
  service: McpService;
  /** 测试注入：假 fetch / 假端点。 */
  registry?: RegistryClientOptions;
  builtin?: McpCatalogEntry[];
  log?: (level: "info" | "warn" | "error", message: string, data?: unknown) => void;
};

/**
 * MCP 市场：内置目录 + 官方 Registry 的合并搜索与安装。
 *
 * 内置目录永远先返回；Registry 失败只体现在 `remoteError`，不影响内置条目。
 * 安装不新增写入路径：模板 → `McpServerInput` → `McpService.upsert`
 * （因此同样享受校验、原子写与 stdio 授权确认）。
 */
export class McpMarket {
  private readonly service: McpService;
  private readonly builtin: McpCatalogEntry[];
  private readonly registry: RegistryClientOptions;
  private readonly log?: McpMarketOptions["log"];

  constructor(options: McpMarketOptions) {
    this.service = options.service;
    this.builtin = options.builtin ?? BUILTIN_MCP_CATALOG.servers;
    this.registry = options.registry ?? {};
    this.log = options.log;
  }

  async search(query = "", cursor?: string, more = false): Promise<McpMarketSearchResult> {
    const trimmed = String(query ?? "").trim();
    const builtin: McpMarketEntry[] = more
      ? []
      : this.builtin
          .filter((entry) => matchesCatalogQuery(entry, trimmed))
          .map((entry) => ({ ...entry, source: "builtin" as const }));

    let remoteEntries: McpMarketEntry[] = [];
    let nextCursor: string | undefined;
    let remoteError: string | undefined;
    try {
      const result = await searchRegistry(trimmed, cursor, this.registry);
      remoteEntries = result.entries.map((entry) => ({ ...entry, source: "official" as const }));
      nextCursor = result.nextCursor;
    } catch (error) {
      remoteError = registryErrorMessage(error);
      this.log?.("warn", "MCP Registry 搜索失败，已降级到内置目录", {
        error: (error as Error)?.message,
      });
    }

    // 内置条目优先：Registry 返回同 id 时不覆盖用户熟悉的模板。
    const seen = new Set(builtin.map((entry) => entry.id));
    const entries = [...builtin];
    for (const entry of remoteEntries) {
      if (seen.has(entry.id)) continue;
      seen.add(entry.id);
      entries.push(entry);
    }
    return { entries, ...(nextCursor ? { nextCursor } : {}), ...(remoteError ? { remoteError } : {}) };
  }

  /**
   * 安装一条市场模板。
   *
   * 渲染层传来的 entry 属于不可信输入：主进程重新校验模板与值，
   * 再走与手工新增完全相同的 upsert 路径。
   */
  async install(
    entry: McpCatalogEntry,
    values: Record<string, string> = {},
  ): Promise<{ server: Awaited<ReturnType<McpService["upsert"]>>["server"]; cancelled?: boolean }> {
    const error = catalogEntryError(entry);
    if (error) throw new Error(`市场条目不可安装：${error}`);
    const input = resolveCatalogEntry(entry, values);
    const result = await this.service.upsert(input);
    return { server: result.server, ...(result.cancelled ? { cancelled: true } : {}) };
  }
}

function registryErrorMessage(error: unknown): string {
  if (error instanceof RegistryError) {
    switch (error.code) {
      case "TIMEOUT":
        return "在线搜索超时，已显示内置目录";
      case "LIMIT":
        return "官方 Registry 响应过大，已显示内置目录";
      case "PARSE":
        return "官方 Registry 返回格式异常，已显示内置目录";
      case "HTTP":
        return `官方 Registry 请求失败：${error.message}`;
      case "NETWORK":
        return `无法连接官方 Registry：${error.message}`;
    }
  }
  return "在线搜索失败，已显示内置目录";
}
