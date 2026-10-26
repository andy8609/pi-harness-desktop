/**
 * MCP 配置与状态的共享类型、限制常量、纯校验/映射函数。
 *
 * 本模块刻意保持**零项目内依赖**：主进程、渲染进程与 Node 测试运行器都要加载它，
 * 因此不能 import `electron`、SDK 或其它业务模块。校验失败一律返回中文可读错误。
 */

export type McpTransport = "stdio" | "http";

export type McpConnectionState = "idle" | "connecting" | "ready" | "failed";

/** 激活范围：全局，或仅在指定项目目录下激活。 */
export interface McpScope {
  mode: "global" | "projects";
  projects: string[];
}

/** 持久化的服务器记录。 */
export interface McpServerRecord {
  id: string;
  label: string;
  description?: string;
  transport: McpTransport;
  /** stdio：可执行文件名或绝对路径。 */
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  /** http：绝对 endpoint，仅允许 http/https。 */
  url?: string;
  headers?: Record<string, string>;
  enabled: boolean;
  scope: McpScope;
  /** 工具级开关：列出的工具不注册给模型（T12）。 */
  disabledTools?: string[];
  createdAt: string;
  updatedAt: string;
}

/** 新增/编辑服务器时接受的字段。 */
export interface McpServerInput {
  id: string;
  label?: string;
  description?: string;
  transport: McpTransport;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  enabled?: boolean;
  scope?: McpScope;
  disabledTools?: string[];
}

/** 服务器连接状态，供设置页展示。 */
export interface McpServerStatus {
  serverId: string;
  state: McpConnectionState;
  toolCount: number;
  toolNames?: string[];
  message?: string;
  updatedAt: number;
  /** 远程服务器返回 401/403 时置位，UI 引导用户填写 Authorization。 */
  authRequired?: boolean;
  /** 工具数超过单服务器上限时置位。 */
  truncated?: boolean;
}

/** `tools/list` 返回并缓存到运行时的工具。 */
export interface McpToolInfo {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

/** 设置页工具清单的一行。 */
export interface McpToolView {
  name: string;
  description?: string;
  enabled: boolean;
}

/** 广播给渲染进程的 MCP 快照。 */
export interface McpSnapshot {
  servers: McpServerRecord[];
  statuses: McpServerStatus[];
}

/** 磁盘文件结构。 */
export interface McpFile {
  version: 1;
  servers: McpServerRecord[];
}

/** 与源项目一致的限制常量。 */
export const MCP_LIMITS = {
  servers: 128,
  args: 64,
  envEntries: 64,
  headers: 32,
  valueBytes: 4096,
  idLength: 64,
  labelLength: 128,
  descriptionLength: 1024,
  disabledTools: 256,
  toolsPerServer: 64,
  activeServers: 16,
  toolPages: 8,
  stdioLineBytes: 4 * 1024 * 1024,
  httpBodyBytes: 4 * 1024 * 1024,
  redirects: 5,
  connectTimeoutMs: 10_000,
  callTimeoutMs: 100_000,
  toolDescriptionLength: 1024,
} as const;

export const MCP_PROTOCOL_VERSION = "2025-06-18";

export const MCP_ID_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/;
export const MCP_ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
export const MCP_HEADER_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]*$/;

const GLOBAL_SCOPE: McpScope = { mode: "global", projects: [] };

/** 把任意 scope 收敛成合法形状。 */
export function normalizeScope(scope: McpScope | undefined): McpScope {
  if (!scope || scope.mode !== "projects") return { ...GLOBAL_SCOPE };
  const projects: string[] = [];
  for (const entry of Array.isArray(scope.projects) ? scope.projects : []) {
    const normalized = normalizeProjectPath(entry);
    if (normalized && !projects.some((item) => sameProjectPath(item, normalized))) projects.push(normalized);
  }
  // 「指定项目」但没有项目等价于谁也用不了；回退全局，避免配置看起来生效实际不生效。
  if (projects.length === 0) return { ...GLOBAL_SCOPE };
  return { mode: "projects", projects };
}

export function normalizeProjectPath(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  const unified = trimmed.replace(/\\/g, "/").replace(/\/+$/, "");
  return unified || "/";
}

export function sameProjectPath(a: string, b: string): boolean {
  const left = normalizeProjectPath(a);
  const right = normalizeProjectPath(b);
  if (!left || !right) return false;
  // Windows 路径大小写不敏感；macOS 一般也不敏感，Linux 敏感。
  // renderer 与 Node 测试运行器都可能没有 process，缺省按不敏感比较。
  const linux = typeof process !== "undefined" && process.platform === "linux";
  return linux ? left === right : left.toLowerCase() === right.toLowerCase();
}

/** 记录是否在给定项目下激活（对应源项目 `isActiveInProject`）。 */
export function isServerActiveForProject(
  record: Pick<McpServerRecord, "enabled" | "scope">,
  projectPath: string | null | undefined,
): boolean {
  if (!record.enabled) return false;
  const scope = normalizeScope(record.scope);
  if (scope.mode === "global") return true;
  const target = normalizeProjectPath(projectPath);
  if (!target) return false;
  return scope.projects.some((entry) => sameProjectPath(entry, target));
}

/** 模型看到的工具名：`mcp_<serverId>_<toolName>`，非字母数字下划线替换（与源项目一致）。 */
export function mcpToolName(serverId: string, toolName: string): string {
  return `mcp_${sanitizeToolPart(serverId)}_${sanitizeToolPart(toolName)}`;
}

export function sanitizeToolPart(value: string): string {
  return String(value).replace(/[^a-zA-Z0-9_]/g, "_");
}

/** 从命名空间工具名反解服务器与工具，用于调用路由。 */
export function parseMcpToolName(
  fullName: string,
  servers: ReadonlyArray<Pick<McpServerRecord, "id">>,
  toolsByServer: ReadonlyMap<string, ReadonlyArray<McpToolInfo>>,
): { serverId: string; toolName: string } | undefined {
  for (const server of servers) {
    const tools = toolsByServer.get(server.id) ?? [];
    for (const tool of tools) {
      if (mcpToolName(server.id, tool.name) === fullName) {
        return { serverId: server.id, toolName: tool.name };
      }
    }
  }
  return undefined;
}

/**
 * 校验并规范化一条服务器配置。
 *
 * @returns 成功时给出可直接落盘的字段（不含时间戳），失败时给出中文原因。
 */
export function normalizeMcpServerInput(
  input: Partial<McpServerInput> | null | undefined,
  options: { now: string; createdAt?: string },
): { ok: true; server: McpServerRecord } | { ok: false; error: string } {
  if (!input || typeof input !== "object") return { ok: false, error: "配置不能为空" };

  const id = typeof input.id === "string" ? input.id.trim() : "";
  if (!MCP_ID_PATTERN.test(id)) {
    return { ok: false, error: "id 必须字母开头，只能包含字母、数字、下划线、连字符，最长 64 位" };
  }

  const transport = input.transport;
  if (transport !== "stdio" && transport !== "http") {
    return { ok: false, error: "transport 必须是 stdio 或 http" };
  }

  const label = clampText(input.label, MCP_LIMITS.labelLength) || id;
  const description = clampText(input.description, MCP_LIMITS.descriptionLength) || undefined;
  const scope = normalizeScope(input.scope);
  const enabled = input.enabled !== false;

  const disabledTools: string[] = [];
  if (Array.isArray(input.disabledTools)) {
    for (const entry of input.disabledTools) {
      const name = typeof entry === "string" ? entry.trim() : "";
      if (!name) continue;
      if (!disabledTools.includes(name)) disabledTools.push(name);
      if (disabledTools.length >= MCP_LIMITS.disabledTools) break;
    }
  }

  const base = {
    id,
    label,
    ...(description ? { description } : {}),
    transport,
    enabled,
    scope,
    ...(disabledTools.length ? { disabledTools } : {}),
    createdAt: options.createdAt ?? options.now,
    updatedAt: options.now,
  } satisfies Omit<McpServerRecord, "command" | "args" | "env" | "url" | "headers">;

  if (transport === "stdio") {
    const command = typeof input.command === "string" ? input.command.trim() : "";
    if (!command) return { ok: false, error: "stdio 服务器必须填写 command" };
    if (command.length > MCP_LIMITS.valueBytes) return { ok: false, error: "command 过长" };
    if (command.split(/[\\/]/).some((part) => part === "..")) {
      return { ok: false, error: 'command 不能包含 ".."' };
    }
    const args = validateStringList(input.args, MCP_LIMITS.args, "args");
    if (!args.ok) return args;
    const env = validateStringMap(input.env, MCP_ENV_KEY_PATTERN, MCP_LIMITS.envEntries, "env");
    if (!env.ok) return env;
    return {
      ok: true,
      server: {
        ...base,
        command,
        ...(args.value.length ? { args: args.value } : {}),
        ...(Object.keys(env.value).length ? { env: env.value } : {}),
      },
    };
  }

  const url = typeof input.url === "string" ? input.url.trim() : "";
  const urlError = validateRemoteUrl(url);
  if (urlError) return { ok: false, error: urlError };
  const headers = validateStringMap(input.headers, MCP_HEADER_KEY_PATTERN, MCP_LIMITS.headers, "headers");
  if (!headers.ok) return headers;
  return {
    ok: true,
    server: {
      ...base,
      url,
      ...(Object.keys(headers.value).length ? { headers: headers.value } : {}),
    },
  };
}

/** 远程 endpoint 仅接受 http/https。 */
export function validateRemoteUrl(url: string): string | undefined {
  if (!url) return "http 服务器必须填写 url";
  if (url.length > MCP_LIMITS.valueBytes) return "url 过长";
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "url 不是合法地址";
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return "url 只支持 http 或 https";
  }
  return undefined;
}

function clampText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

/** 与 Buffer.byteLength 等价，但不依赖 Node 全局（renderer 也要调用）。 */
function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

function validateStringList(
  value: unknown,
  max: number,
  field: string,
): { ok: true; value: string[] } | { ok: false; error: string } {
  if (value === undefined || value === null) return { ok: true, value: [] };
  if (!Array.isArray(value)) return { ok: false, error: `${field} 必须是数组` };
  if (value.length > max) return { ok: false, error: `${field} 最多 ${max} 项` };
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") return { ok: false, error: `${field} 只能包含字符串` };
    if (byteLength(entry) > MCP_LIMITS.valueBytes) return { ok: false, error: `${field} 单项过长` };
    out.push(entry);
  }
  return { ok: true, value: out };
}

function validateStringMap(
  value: unknown,
  keyPattern: RegExp,
  max: number,
  field: string,
): { ok: true; value: Record<string, string> } | { ok: false; error: string } {
  if (value === undefined || value === null) return { ok: true, value: {} };
  if (typeof value !== "object" || Array.isArray(value)) return { ok: false, error: `${field} 必须是键值对象` };
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > max) return { ok: false, error: `${field} 最多 ${max} 项` };
  const out: Record<string, string> = {};
  for (const [key, raw] of entries) {
    if (!keyPattern.test(key)) return { ok: false, error: `${field} 的键 "${key}" 不合法` };
    if (typeof raw !== "string") return { ok: false, error: `${field}.${key} 必须是字符串` };
    if (byteLength(raw) > MCP_LIMITS.valueBytes) return { ok: false, error: `${field}.${key} 值过长` };
    out[key] = raw;
  }
  return { ok: true, value: out };
}

/** 配置编辑后是否需要重建连接（对齐源项目 `configurationChanged`）。 */
export function mcpConfigurationChanged(before: McpServerRecord, after: McpServerRecord): boolean {
  if (before.enabled && !after.enabled) return true;
  if (before.transport !== after.transport) return true;
  if ((before.command ?? "") !== (after.command ?? "")) return true;
  if (JSON.stringify(before.args ?? []) !== JSON.stringify(after.args ?? [])) return true;
  if (JSON.stringify(before.env ?? {}) !== JSON.stringify(after.env ?? {})) return true;
  if ((before.url ?? "") !== (after.url ?? "")) return true;
  if (JSON.stringify(before.headers ?? {}) !== JSON.stringify(after.headers ?? {})) return true;
  return false;
}


/** 深拷贝一条记录，避免调用方修改运行时状态。 */
export function cloneMcpServerRecord(record: McpServerRecord): McpServerRecord {
  return {
    ...record,
    scope: { mode: record.scope.mode, projects: [...record.scope.projects] },
    ...(record.args ? { args: [...record.args] } : {}),
    ...(record.env ? { env: { ...record.env } } : {}),
    ...(record.headers ? { headers: { ...record.headers } } : {}),
    ...(record.disabledTools ? { disabledTools: [...record.disabledTools] } : {}),
  };
}

/**
 * 把一行命令行拆成参数数组，尊重单/双引号。
 *
 * 表单里让用户按 README 的写法直接粘贴 `npx -y pkg --flag "a b"`，
 * 比逼用户逐行填参数友好得多。引号内的空格保留。
 */
export function splitArgs(value: string): string[] {
  const out: string[] = [];
  let current = "";
  let quote: string | null = null;
  let started = false;
  for (const ch of value) {
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      started = true;
      continue;
    }
    if (/\s/.test(ch)) {
      if (started) {
        out.push(current);
        current = "";
        started = false;
      }
      continue;
    }
    current += ch;
    started = true;
  }
  if (started) out.push(current);
  return out;
}

/** 表单展示用：把参数数组拼回一行，含空格的参数加引号。 */
export function joinArgs(args: readonly string[] | undefined): string {
  return (args ?? [])
    .map((arg) => (/\s/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg))
    .join(" ");
}

/** 给 UI 的掩码值：非空即显示固定掩码，避免把凭据渲染进 DOM。 */
export function maskSecret(value: string): string {
  return value ? "••••••••" : "";
}
