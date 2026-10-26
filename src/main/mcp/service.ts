import type {
  McpScope,
  McpServerInput,
  McpServerRecord,
  McpServerStatus,
  McpSnapshot,
  McpToolView,
} from "@shared/mcp";
import type { McpClientFactory, McpRuntimeLogger } from "./runtime";
import { McpRuntime } from "./runtime";
import type { McpStoreLogger } from "./store";
import { McpStore } from "./store";
import { McpToolBridge, type McpToolBridgeLogger } from "./tools";

export type { McpSnapshot, McpToolView };

export interface McpStdioConfirmContext {
  isNew: boolean;
  /** 已经确认过的命令；编辑其它字段时不必再弹一次。 */
  previouslyApproved: boolean;
}

export interface McpServiceOptions {
  /** 配置文件绝对路径（通常 userData/mcp-servers.json）。 */
  filePath: string;
  /** 状态快照广播；由 main 进程注入。 */
  broadcast: (snapshot: McpSnapshot) => void;
  log?: McpRuntimeLogger;
  /** stdio 服务器授权确认（T13）；未注入时不做确认。 */
  confirmStdio?: (record: McpServerRecord, context: McpStdioConfirmContext) => Promise<boolean>;
  connectTimeoutMs?: number;
  callTimeoutMs?: number;
  /** 测试注入点：默认创建真实 MCP 客户端。 */
  createClient?: McpClientFactory;
}

/**
 * MCP 功能的门面：配置（store）+ 连接（runtime）+ 工具注册（bridge）。
 *
 * IPC 层只跟它打交道；`AgentHost` 只拿 runtime 与 bridge。这样 T13 的授权确认、
 * 启动连接、变更广播都集中在一处。
 */
export class McpService {
  readonly store: McpStore;
  readonly runtime: McpRuntime;
  readonly bridge: McpToolBridge;
  private readonly options: McpServiceOptions;
  private readonly log: McpRuntimeLogger;
  private broadcastTimer: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;

  constructor(options: McpServiceOptions) {
    this.options = options;
    this.log = (level, message, data) => {
      const text = `[mcp] ${message}`;
      if (level === "error") console.error(text, data ?? "");
      else if (level === "warn") console.warn(text, data ?? "");
      else console.info(text, data ?? "");
      const target = options.log;
      if (target && target !== this.log) target(level, message, data);
    };

    const storeLog: McpStoreLogger = (level, message, data) => this.log(level, message, data);
    this.store = new McpStore({ filePath: options.filePath, log: storeLog });
    this.runtime = new McpRuntime({
      log: this.log,
      createClient: options.createClient,
      connectTimeoutMs: options.connectTimeoutMs,
      callTimeoutMs: options.callTimeoutMs,
      onChanged: () => this.handleRuntimeChanged(),
    });
    const bridgeLog: McpToolBridgeLogger = (level, message, data) => this.log(level, message, data);
    this.bridge = new McpToolBridge({ runtime: this.runtime, log: bridgeLog });
  }

  /** 启动/切换项目：采纳配置、设置项目激活范围、连接全局服务器。 */
  initialize(projectPath: string | null): void {
    this.runtime.setRecords(this.store.list());
    this.runtime.setProjectPath(projectPath);
    void this.runtime.connectAll();
    this.handleRuntimeChanged();
  }

  snapshot(): McpSnapshot {
    return { servers: this.store.list(), statuses: this.runtime.listStatuses() };
  }

  async upsert(input: Partial<McpServerInput>): Promise<{ server: McpServerRecord; cancelled?: boolean }> {
    const existing = typeof input?.id === "string" ? this.store.get(input.id.trim()) : undefined;
    const saved = this.store.upsert(input);
    this.emitNow();

    if (saved.transport === "stdio" && saved.enabled && this.options.confirmStdio) {
      // 确认框本身可能失败（窗口已关闭等），失败按「未授权」处理，绝不放行。
      const approved = await this.options
        .confirmStdio(saved, {
          isNew: !existing,
          previouslyApproved: Boolean(existing && existing.command === saved.command && existing.enabled),
        })
        .catch(() => false);
      if (!approved) {
        // 用户在确认框点了取消：新增的删除，已有的回滚为禁用。
        if (existing) this.store.setEnabled(saved.id, false);
        else this.store.remove(saved.id);
        this.runtime.setRecords(this.store.list());
        this.runtime.disconnect(saved.id);
        this.emitNow();
        return { server: existing ?? saved, cancelled: true };
      }
    }

    this.runtime.setRecords(this.store.list());
    if (saved.enabled) {
      // 与源项目一致：保存后立刻握手一次，状态直接反映在列表里。
      void this.runtime.test(saved.id).then(() => this.emitNow());
    } else {
      this.runtime.disconnect(saved.id);
    }
    this.emitNow();
    return { server: saved };
  }

  remove(id: string): { removed: boolean } {
    const removed = this.store.remove(id);
    this.runtime.setRecords(this.store.list());
    this.runtime.disconnect(id);
    this.emitNow();
    return { removed };
  }

  setEnabled(id: string, enabled: boolean): { server: McpServerRecord } {
    const server = this.store.setEnabled(id, enabled);
    this.runtime.setRecords(this.store.list());
    if (!enabled) this.runtime.disconnect(id);
    this.emitNow();
    return { server };
  }

  setScope(id: string, scope: McpScope): { server: McpServerRecord } {
    const server = this.store.setScope(id, scope);
    this.runtime.setRecords(this.store.list());
    this.emitNow();
    return { server };
  }

  /** 测试连接：强制重新握手。 */
  async test(id: string): Promise<{ status: McpServerStatus }> {
    this.runtime.setRecords(this.store.list());
    const status = await this.runtime.test(id);
    this.emitNow();
    return { status };
  }

  async reconnect(id: string): Promise<{ status: McpServerStatus }> {
    return this.test(id);
  }

  disconnect(id: string): { ok: boolean } {
    this.runtime.disconnect(id);
    this.emitNow();
    return { ok: true };
  }

  listTools(serverId: string): { tools: McpToolView[] } {
    const record = this.store.get(serverId);
    const disabled = new Set(record?.disabledTools ?? []);
    return {
      tools: this.runtime.getTools(serverId).map((tool) => ({
        name: tool.name,
        ...(tool.description ? { description: tool.description } : {}),
        enabled: !disabled.has(tool.name),
      })),
    };
  }

  setToolEnabled(serverId: string, toolName: string, enabled: boolean): { server: McpServerRecord } {
    const server = this.store.setToolEnabled(serverId, toolName, enabled);
    this.runtime.setRecords(this.store.list());
    this.bridge.sync();
    this.emitNow();
    return { server };
  }

  /** 重新读盘（外部编辑配置文件后）。 */
  refresh(): McpSnapshot {
    this.store.load();
    this.runtime.setRecords(this.store.list());
    this.bridge.sync();
    this.emitNow();
    return this.snapshot();
  }

  setProjectPath(projectPath: string | null): void {
    this.runtime.setProjectPath(projectPath);
    void this.runtime.toolsForProject().then(() => this.emitNow());
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.broadcastTimer) {
      clearTimeout(this.broadcastTimer);
      this.broadcastTimer = undefined;
    }
    this.bridge.detach();
    this.runtime.disposeAll();
  }

  private handleRuntimeChanged(): void {
    this.bridge.sync();
    // 握手过程中状态会连续变化，合并成一次广播，避免 UI 抖动。
    if (this.broadcastTimer) return;
    this.broadcastTimer = setTimeout(() => {
      this.broadcastTimer = undefined;
      this.emitNow();
    }, 50);
  }

  private emitNow(): void {
    if (this.disposed) return;
    this.options.broadcast(this.snapshot());
  }
}
