/**
 * MCP 市场的模板词汇表。
 *
 * 一条市场条目就是一份「服务器模板」：浏览、填几个值，然后走现有的
 * `McpServerInput` 校验与落盘路径。本模块只做纯数据处理，不发起任何 I/O，
 * 因此主进程、渲染层与 Node 测试都能直接加载。
 */
import type { McpServerInput } from "./mcp";

export type McpCatalogCategory = "devtools" | "web" | "docs" | "data" | "productivity";

/** 安装模板需要用户填写的一个值。 */
export type McpCatalogRequiredEnv = {
  name: string;
  description?: string;
  optional?: boolean;
  /** 安装表单的预填值；用户输入优先。 */
  defaultValue?: string;
};

export type McpCatalogEntry = {
  id: string;
  name: string;
  description?: string;
  author?: string;
  homepage?: string;
  categories?: McpCatalogCategory[];
  verified?: boolean;
  transport: "stdio" | "http";
  /** stdio 模板：command/args/env 均支持 `${NAME}` 占位符。 */
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  /** http 模板：必须是公网 https。 */
  url?: string;
  headers?: Record<string, string>;
  requiredEnv?: McpCatalogRequiredEnv[];
  prerequisites?: string[];
  notes?: string;
};

export type McpCatalogFile = {
  schemaVersion: 1;
  updatedAt: string;
  source: "builtin";
  servers: McpCatalogEntry[];
};

/** 市场条目的来源标记（内置 / 官方 Registry）。 */
export type McpMarketSource = "builtin" | "official";

export type McpMarketEntry = McpCatalogEntry & { source: McpMarketSource };

/** 市场搜索的统一返回。`remoteError` 存在时内置目录仍然可用。 */
export type McpMarketSearchResult = {
  entries: McpMarketEntry[];
  /** 还有下一页时给出游标。 */
  nextCursor?: string;
  /** 在线搜索失败的用户可读原因。 */
  remoteError?: string;
};

const PLACEHOLDER = /\$\{([A-Z_][A-Z0-9_]*)\}/g;
const CATALOG_CATEGORIES = new Set<McpCatalogCategory>([
  "devtools",
  "web",
  "docs",
  "data",
  "productivity",
]);
const ENV_NAME = /^[A-Z_][A-Z0-9_]*$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((item) => typeof item === "string");
}

function isPrivateHostname(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host === "::1" || host === "0.0.0.0") return true;
  if (/^127\./.test(host)) return true;
  if (/^10\./.test(host)) return true;
  if (/^192\.168\./.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
  if (/^169\.254\./.test(host)) return true;
  return false;
}

/**
 * 市场模板只接受公网 https 地址。
 *
 * 这里不复制源项目 400 行的 DNS/SSRF 策略：Registry 端点固定为官方域名，
 * 模板地址来自官方索引；拒绝 localhost 与私网字面量足以避免把市场
 * 条目指向本机服务。
 */
export function isSafeHttpsUrl(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  if (!parsed.hostname) return false;
  return !isPrivateHostname(parsed.hostname);
}

function requiredEnvError(value: unknown, id: string): string | null {
  if (!Array.isArray(value)) return `${id}: requiredEnv 必须是数组`;
  const names = new Set<string>();
  for (const item of value) {
    if (!isRecord(item)) return `${id}: requiredEnv 的每一项必须是对象`;
    if (typeof item.name !== "string" || !ENV_NAME.test(item.name)) {
      return `${id}: requiredEnv 的 name 必须是环境变量名（大写字母/数字/下划线）`;
    }
    if (names.has(item.name)) return `${id}: requiredEnv 重复声明 ${item.name}`;
    names.add(item.name);
    if (item.description !== undefined && typeof item.description !== "string") {
      return `${id}: requiredEnv 的 description 必须是字符串`;
    }
    if (item.optional !== undefined && typeof item.optional !== "boolean") {
      return `${id}: requiredEnv 的 optional 必须是布尔值`;
    }
    if (item.defaultValue !== undefined && typeof item.defaultValue !== "string") {
      return `${id}: requiredEnv 的 defaultValue 必须是字符串`;
    }
  }
  return null;
}

function entryShapeError(value: unknown): string | null {
  if (!isRecord(value)) return "条目必须是对象";
  const id = typeof value.id === "string" ? value.id : "unknown";
  if (typeof value.id !== "string" || !/^[a-z][a-z0-9_-]{0,63}$/.test(value.id)) return `id 不合法：${id}`;
  if (typeof value.name !== "string" || !value.name.trim()) return `${id}: name 不能为空`;
  if (value.transport !== "stdio" && value.transport !== "http") return `${id}: transport 不合法`;

  if (value.categories !== undefined) {
    if (
      !Array.isArray(value.categories) ||
      !value.categories.every(
        (category) => typeof category === "string" && CATALOG_CATEGORIES.has(category as McpCatalogCategory),
      )
    ) {
      return `${id}: categories 必须是已知分类数组`;
    }
  }
  if (value.args !== undefined && !isStringArray(value.args)) return `${id}: args 必须是字符串数组`;
  if (value.env !== undefined && !isStringRecord(value.env)) return `${id}: env 必须是字符串键值对象`;
  if (value.headers !== undefined && !isStringRecord(value.headers)) return `${id}: headers 必须是字符串键值对象`;
  if (value.prerequisites !== undefined && !isStringArray(value.prerequisites)) {
    return `${id}: prerequisites 必须是字符串数组`;
  }
  if (value.requiredEnv !== undefined) {
    const error = requiredEnvError(value.requiredEnv, id);
    if (error) return error;
  }
  for (const field of ["description", "author", "homepage", "command", "url", "notes"]) {
    if (value[field] !== undefined && typeof value[field] !== "string") return `${id}: ${field} 必须是字符串`;
  }
  if (value.verified !== undefined && typeof value.verified !== "boolean") return `${id}: verified 必须是布尔值`;
  return null;
}

function templateStrings(entry: McpCatalogEntry): string[] {
  if (entry.transport === "http") {
    return [
      typeof entry.url === "string" ? entry.url : "",
      ...(isStringRecord(entry.headers) ? Object.values(entry.headers) : []),
    ];
  }
  return [
    typeof entry.command === "string" ? entry.command : "",
    ...(isStringArray(entry.args) ? entry.args : []),
    ...(isStringRecord(entry.env) ? Object.values(entry.env) : []),
  ];
}

/** 模板中出现的全部 `${NAME}`，去重并排序。 */
export function collectCatalogPlaceholders(entry: McpCatalogEntry): string[] {
  const names = new Set<string>();
  for (const text of templateStrings(entry)) {
    for (const match of text.matchAll(PLACEHOLDER)) names.add(match[1]);
  }
  return [...names].sort();
}

function declaredNames(entry: McpCatalogEntry): Map<string, McpCatalogRequiredEnv> {
  return new Map((entry.requiredEnv ?? []).map((item) => [item.name, item]));
}

/** 校验收到的模板：结构、传输方式、地址安全、占位符声明。 */
export function catalogEntryError(entry: McpCatalogEntry | unknown): string | null {
  const shapeError = entryShapeError(entry);
  if (shapeError) return shapeError;
  const candidate = entry as McpCatalogEntry;
  if (candidate.transport === "stdio") {
    if (!candidate.command?.trim()) return `${candidate.id}: stdio 必须填写 command`;
    if (candidate.command.includes("..")) return `${candidate.id}: command 不能包含 ..`;
  } else {
    if (!candidate.url) return `${candidate.id}: http 必须填写 url`;
    if (!isSafeHttpsUrl(candidate.url)) return `${candidate.id}: 市场地址必须是公网 https`;
  }
  const declared = declaredNames(candidate);
  for (const name of collectCatalogPlaceholders(candidate)) {
    if (!declared.has(name)) return `${candidate.id}: 占位符 ${name} 未在 requiredEnv 中声明`;
  }
  return null;
}

/**
 * 把模板变成真正的服务器配置。
 *
 * 必填值缺失时抛错（安装表单直接展示）；optional 值为空时整条 env/header
 * 被丢弃，避免把字面量 `${NAME}` 传给子进程。
 */
export function resolveCatalogEntry(
  entry: McpCatalogEntry,
  values: Record<string, string> = {},
): McpServerInput {
  const error = catalogEntryError(entry);
  if (error) throw new Error(error);
  const declared = declaredNames(entry);
  const fill = (text: string): string =>
    text.replace(PLACEHOLDER, (_whole, name: string) => {
      const spec = declared.get(name);
      const value = values[name] ?? spec?.defaultValue ?? "";
      if (!value && !spec?.optional) {
        throw new Error(`${entry.name}: 缺少 ${name} 的值`);
      }
      return value;
    });
  const base = {
    id: entry.id,
    label: entry.name,
    ...(entry.description ? { description: entry.description } : {}),
    enabled: true,
  };
  if (entry.transport === "http") {
    const headers: Record<string, string> = {};
    for (const [key, template] of Object.entries(entry.headers ?? {})) {
      const value = fill(template);
      if (value) headers[key] = value;
    }
    return {
      ...base,
      transport: "http",
      url: fill(entry.url ?? ""),
      ...(Object.keys(headers).length ? { headers } : {}),
    };
  }
  const env: Record<string, string> = {};
  for (const [key, template] of Object.entries(entry.env ?? {})) {
    const value = fill(template);
    if (value) env[key] = value;
  }
  return {
    ...base,
    transport: "stdio",
    command: fill(entry.command ?? ""),
    args: (entry.args ?? []).map((arg) => fill(arg)),
    ...(Object.keys(env).length ? { env } : {}),
  };
}

/** 宽松解析目录文件：坏条目变成警告，而不是整体加载失败。 */
export function validateMcpCatalogFile(value: unknown): {
  catalog: McpCatalogFile;
  warnings: string[];
} {
  const warnings: string[] = [];
  const root = isRecord(value) ? value : {};
  const rawServers = Array.isArray(root.servers) ? root.servers : [];
  if (!Array.isArray(root.servers)) warnings.push("目录缺少 servers 数组");
  const servers: McpCatalogEntry[] = [];
  const seen = new Set<string>();
  for (const [index, candidate] of rawServers.entries()) {
    if (!isRecord(candidate)) {
      warnings.push(`第 ${index} 条不是对象`);
      continue;
    }
    const id = typeof candidate.id === "string" ? candidate.id : "";
    if (id && seen.has(id)) {
      warnings.push(`重复 id：${id}`);
      continue;
    }
    const error = catalogEntryError(candidate);
    if (error) {
      warnings.push(error);
      continue;
    }
    if (id) seen.add(id);
    servers.push(candidate as McpCatalogEntry);
  }
  return {
    catalog: {
      schemaVersion: 1,
      updatedAt: typeof root.updatedAt === "string" ? root.updatedAt : "",
      source: "builtin",
      servers,
    },
    warnings,
  };
}

/** 本地搜索：名称、描述、作者与分类。 */
export function matchesCatalogQuery(entry: McpCatalogEntry, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return true;
  const haystack = [
    entry.name,
    entry.description ?? "",
    entry.author ?? "",
    ...(entry.categories ?? []),
  ]
    .join(" ")
    .toLocaleLowerCase();
  return haystack.includes(needle);
}
