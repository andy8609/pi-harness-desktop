import { homedir } from "node:os";
import {
  MCP_LIMITS,
  cloneMcpServerRecord,
  isServerActiveForProject,
  mcpConfigurationChanged,
  mcpToolName,
  type McpServerRecord,
  type McpServerStatus,
  type McpToolInfo,
} from "@shared/mcp";
import {
  McpServerClient,
  isHttpStatusError,
  type McpAuditEntry,
  type McpServerClientOptions,
} from "./client";

/** runtime 只依赖客户端的这一小片接口，便于测试注入假实现。 */
export type McpClientLike = {
  connect: () => Promise<McpToolInfo[]>;
  callTool: (toolName: string, args: unknown) => Promise<unknown>;
  getTools: () => McpToolInfo[];
  isConnected: () => boolean;
  close: () => void;
};

export type McpClientFactory = (options: McpServerClientOptions) => McpClientLike;

/** 交给工具注册层的工具描述符。 */
export interface McpToolDescriptor {
  /** 模型看到的完整名字：`mcp_<serverId>_<toolName>`。 */
  fullName: string;
  serverId: string;
  toolName: string;
  description: string;
  schema?: unknown;
}

export type McpRuntimeLogger = (level: "info" | "warn" | "error", message: string, data?: unknown) => void;

export interface McpRuntimeOptions {
  /** 默认用真实客户端；测试注入假实现。 */
  createClient?: McpClientFactory;
  log?: McpRuntimeLogger;
  audit?: (entry: McpAuditEntry) => void;
  /** 状态或工具集变化时回调（IPC 层据此广播）。 */
  onChanged?: () => void;
  connectTimeoutMs?: number;
  callTimeoutMs?: number;
  /** 远程服务器 token 钩子（T13 使用；未提供时不注入 Authorization）。 */
  getAccessToken?: (serverId: string) => Promise<string | null>;
}

type Entry = {
  record: McpServerRecord;
  client: McpClientLike;
  status: McpServerStatus;
  connecting?: Promise<McpToolInfo[]>;
  token?: string | null;
};

/** 失败调用的结构化错误码，供上层转成用户可读提示。 */
export class McpCallError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "McpCallError";
    this.code = code;
  }
}

/**
 * 多服务器 MCP 运行时。
 *
 * - 记录由 `McpStore` 提供，运行时只采纳副本；
 * - 每个服务器独立连接与状态，单台失败不影响其它服务器；
 * - 工具缓存按服务器维护，配置变化立即丢弃连接；
 * - `failed` 的服务器在本次进程生命周期内不自动重试，只由 test/reconnect/编辑触发。
 */
export class McpRuntime {
  private entries = new Map<string, Entry>();
  /**
   * 路由用的工具缓存。传输断开时不清空：模型可能还记着名字，
   * 但派发前必须用新握手列表复核，缓存永远不能作为调用许可。
   */
  private discoveredTools = new Map<string, McpToolInfo[]>();
  private records: McpServerRecord[] = [];
  private projectPath: string | null = null;
  private readonly options: McpRuntimeOptions;

  constructor(options: McpRuntimeOptions = {}) {
    this.options = options;
  }

  /** 采纳一份新配置；配置变化或删除的服务器会立即断开。 */
  setRecords(records: readonly McpServerRecord[]): void {
    this.records = records.map((record) => cloneMcpServerRecord(record));
    const byId = new Map(this.records.map((record) => [record.id, record]));
    for (const id of [...this.discoveredTools.keys()]) {
      if (!byId.has(id)) this.discoveredTools.delete(id);
    }
    for (const [id, entry] of [...this.entries]) {
      const next = byId.get(id);
      if (!next || mcpConfigurationChanged(entry.record, next)) {
        entry.client.close();
        this.entries.delete(id);
        continue;
      }
      entry.record = next;
    }
    this.notify();
  }

  setProjectPath(projectPath: string | null | undefined): void {
    this.projectPath = projectPath ? projectPath : null;
  }

  listRecords(): McpServerRecord[] {
    return this.records.map(cloneMcpServerRecord);
  }

  listStatuses(): McpServerStatus[] {
    return this.records.map((record) => this.statusFor(record.id));
  }

  statusFor(serverId: string): McpServerStatus {
    const entry = this.entries.get(serverId);
    if (entry) return { ...entry.status, toolNames: entry.status.toolNames ? [...entry.status.toolNames] : undefined };
    return { serverId, state: "idle", toolCount: 0, updatedAt: Date.now() };
  }

  /** 某服务器最近一次握手发现的工具（未连接时返回缓存）。 */
  getTools(serverId: string): McpToolInfo[] {
    return (this.discoveredTools.get(serverId) ?? []).map((tool) => ({ ...tool }));
  }

  /** 当前项目下可用的工具描述符（已按启用状态、scope、工具级开关过滤）。 */
  listToolDescriptors(): McpToolDescriptor[] {
    const active = this.activeRecords();
    const out: McpToolDescriptor[] = [];
    for (const record of active) {
      const disabled = new Set(record.disabledTools ?? []);
      for (const tool of this.discoveredTools.get(record.id) ?? []) {
        if (disabled.has(tool.name)) continue;
        out.push({
          fullName: mcpToolName(record.id, tool.name),
          serverId: record.id,
          toolName: tool.name,
          description: describeTool(record, tool),
          schema: tool.inputSchema,
        });
      }
    }
    return out;
  }

  /**
   * 连接当前项目下所有启用的服务器，并返回工具描述符。
   *
   * 慢或坏的服务器不能拖住会话装配：每台自己的超时，失败只记状态。
   */
  async toolsForProject(): Promise<McpToolDescriptor[]> {
    const active = this.activeRecords();
    const admitted = active.slice(0, MCP_LIMITS.activeServers);
    if (admitted.length < active.length) {
      this.options.log?.("warn", "超过活跃 MCP 服务器上限，部分被跳过", {
        limit: MCP_LIMITS.activeServers,
        skipped: active.length - admitted.length,
      });
    }
    await Promise.all(admitted.map((record) => this.connect(record)));
    return this.listToolDescriptors();
  }

  /** 启动时连接当前项目下所有启用的服务器（不关心工具）。 */
  async connectAll(): Promise<void> {
    const active = this.activeRecords().slice(0, MCP_LIMITS.activeServers);
    await Promise.all(active.map((record) => this.connect(record)));
  }

  /**
   * 执行一个 MCP 工具。
   *
   * 名字里带服务器 id，但查找走缓存工具列表：服务器从未声明的名字会被拒绝，
   * 而不是盲目转发。配置刷新后还要用最新握手复核一遍。
   */
  async callTool(fullName: string, args: unknown): Promise<unknown> {
    const found = this.findTool(fullName);
    if (!found) throw new McpCallError("TOOL_NOT_FOUND", `未知的 MCP 工具：${fullName}`);

    const record = this.records.find((item) => item.id === found.serverId);
    if (!record || !isServerActiveForProject(record, this.projectPath)) {
      throw new McpCallError("TOOL_NOT_FOUND", `MCP 服务器 ${found.serverId} 在当前项目未启用`);
    }
    if ((record.disabledTools ?? []).includes(found.toolName)) {
      throw new McpCallError("TOOL_DISABLED", `MCP 工具 ${fullName} 已被禁用`);
    }

    await this.connect(record);

    // 握手期间配置或项目可能已变化。
    const current = this.records.find((item) => item.id === found.serverId);
    if (!current || !isServerActiveForProject(current, this.projectPath)) {
      throw new McpCallError("TOOL_NOT_FOUND", `MCP 服务器 ${found.serverId} 在当前项目未启用`);
    }
    const entry = this.entries.get(found.serverId);
    if (
      !entry ||
      mcpConfigurationChanged(record, current) ||
      entry.status.state !== "ready" ||
      !entry.client.isConnected()
    ) {
      throw new McpCallError("UNAVAILABLE", `MCP 服务器 ${found.serverId} 不可用`);
    }
    if (!entry.client.getTools().some((tool) => tool.name === found.toolName)) {
      throw new McpCallError("TOOL_NOT_FOUND", `未知的 MCP 工具：${fullName}`);
    }

    // 不重试 tools/call：失败响应可能已跟随一次写操作。
    try {
      return await entry.client.callTool(found.toolName, args);
    } catch (error) {
      if (isHttpStatusError(error, 401) || isHttpStatusError(error, 403)) {
        entry.status = {
          ...entry.status,
          state: "failed",
          authRequired: true,
          message: truncateMessage((error as Error).message),
          updatedAt: Date.now(),
        };
        this.notify();
      }
      throw error;
    }
  }

  /** 一次性握手并返回状态，供设置页「测试连接」使用；成功后保留连接。 */
  async test(serverId: string): Promise<McpServerStatus> {
    const record = this.records.find((item) => item.id === serverId);
    if (!record) {
      return {
        serverId,
        state: "failed",
        toolCount: 0,
        message: "服务器不存在",
        updatedAt: Date.now(),
      };
    }
    // 强制重新握手：修好的命令要能重试，而不是复述缓存里的失败。
    this.disconnect(serverId);
    await this.connect(record);
    return this.statusFor(serverId);
  }

  /** 手动重连：与 test 语义相同，单独命名以便 UI 区分按钮文案。 */
  async reconnect(serverId: string): Promise<McpServerStatus> {
    return this.test(serverId);
  }

  /** 断开并清空该服务器缓存。 */
  disconnect(serverId: string): void {
    const entry = this.entries.get(serverId);
    if (entry) {
      entry.client.close();
      this.entries.delete(serverId);
    }
    this.discoveredTools.delete(serverId);
    this.notify();
  }

  /** 只关连接、保留路由缓存（配置编辑时用）。 */
  invalidate(serverId: string): void {
    const entry = this.entries.get(serverId);
    if (entry) {
      entry.client.close();
      this.entries.delete(serverId);
    }
    this.notify();
  }

  /** 应用退出时关闭全部连接与子进程。 */
  disposeAll(): void {
    for (const entry of this.entries.values()) entry.client.close();
    this.entries.clear();
    this.discoveredTools.clear();
  }

  private activeRecords(): McpServerRecord[] {
    return this.records.filter((record) => isServerActiveForProject(record, this.projectPath));
  }

  private findTool(fullName: string): { serverId: string; toolName: string } | undefined {
    for (const [serverId, tools] of this.discoveredTools) {
      for (const tool of tools) {
        if (mcpToolName(serverId, tool.name) === fullName) {
          return { serverId, toolName: tool.name };
        }
      }
    }
    return undefined;
  }

  private async resolveToken(record: McpServerRecord): Promise<string | null> {
    if (record.transport !== "http" || !this.options.getAccessToken) return null;
    try {
      return await this.options.getAccessToken(record.id);
    } catch {
      return null;
    }
  }

  private async connect(record: McpServerRecord): Promise<McpToolInfo[]> {
    const token = await this.resolveToken(record);

    let existing = this.entries.get(record.id);
    if (existing && record.transport === "http" && existing.token !== token) {
      existing.client.close();
      this.entries.delete(record.id);
      existing = undefined;
    }

    if (existing?.connecting) return existing.connecting;
    if (existing?.client.isConnected()) return existing.client.getTools();
    // 本次运行已失败的服务器不再重复握手，直到用户编辑配置或点测试。
    if (existing?.status.state === "failed") return [];

    const entry = existing ?? this.createEntry(record, token);
    entry.connecting = this.handshake(record, entry).finally(() => {
      entry.connecting = undefined;
    });
    return entry.connecting;
  }

  private async handshake(record: McpServerRecord, entry: Entry): Promise<McpToolInfo[]> {
    entry.status = { ...entry.status, state: "connecting", updatedAt: Date.now() };
    this.notify();
    try {
      const tools = await entry.client.connect();
      // 编辑/删除后不能复活被丢弃的连接。
      if (this.entries.get(record.id) !== entry) {
        entry.client.close();
        return [];
      }
      this.discoveredTools.set(record.id, tools.map((tool) => ({ ...tool })));
      entry.status = {
        serverId: record.id,
        state: "ready",
        toolCount: tools.length,
        toolNames: tools.map((tool) => tool.name),
        updatedAt: Date.now(),
        authRequired: false,
        ...(tools.length >= MCP_LIMITS.toolsPerServer ? { truncated: true } : {}),
      };
      this.notify();
      return tools;
    } catch (error) {
      const message = truncateMessage((error as Error)?.message ?? String(error));
      entry.status = {
        serverId: record.id,
        state: "failed",
        toolCount: 0,
        message,
        updatedAt: Date.now(),
        authRequired: isHttpStatusError(error, 401) || isHttpStatusError(error, 403),
      };
      this.options.log?.("warn", "MCP 服务器连接失败", { serverId: record.id, message });
      this.notify();
      return [];
    }
  }

  private createEntry(record: McpServerRecord, token?: string | null): Entry {
    const headers = {
      ...(record.headers ?? {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
    const create =
      this.options.createClient ??
      ((options: McpServerClientOptions): McpClientLike => new McpServerClient(options));
    const client = create({
      serverId: record.id,
      label: record.label,
      transport: record.transport,
      rootPath: this.projectPath ?? homedir(),
      command: record.command,
      args: record.args ?? [],
      values: record.transport === "stdio" ? (record.env ?? {}) : headers,
      url: record.url,
      audit: this.options.audit,
      connectTimeoutMs: this.options.connectTimeoutMs,
      callTimeoutMs: this.options.callTimeoutMs,
    });
    const entry: Entry = {
      record,
      client,
      token,
      status: {
        serverId: record.id,
        state: "idle",
        toolCount: 0,
        updatedAt: Date.now(),
      },
    };
    this.entries.set(record.id, entry);
    return entry;
  }

  private notify(): void {
    this.options.onChanged?.();
  }
}


function describeTool(record: McpServerRecord, tool: McpToolInfo): string {
  const raw = tool.description?.trim() || `${record.label} 的 ${tool.name} 工具（MCP）`;
  return raw.length > MCP_LIMITS.toolDescriptionLength
    ? raw.slice(0, MCP_LIMITS.toolDescriptionLength)
    : raw;
}

function truncateMessage(message: string): string {
  return message.length > 500 ? message.slice(0, 500) : message;
}
