import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describeMcpToolError, normalizeMcpResult } from "./content";
import type { McpRuntime, McpToolDescriptor } from "./runtime";

export type McpToolBridgeLogger = (level: "info" | "warn" | "error", message: string, data?: unknown) => void;

export interface McpToolBridgeOptions {
  runtime: McpRuntime;
  log?: McpToolBridgeLogger;
}

/** MCP 工具名前缀：同步激活集合时用它区分「归 MCP 管」的工具。 */
export const MCP_TOOL_PREFIX = "mcp_";

/**
 * 把 runtime 发现的工具接到 pi 的工具注册表。
 *
 * pi 没有 `unregisterTool`，因此「移除工具」通过 `setActiveTools` 实现：
 * 定义留在注册表里，但不在激活集合中的工具不会发给模型。
 * `registerTool` 可以重复调用（同名覆盖），所以刷新就是重新注册一遍。
 */
export class McpToolBridge {
  private readonly runtime: McpRuntime;
  private readonly log?: McpToolBridgeLogger;
  private pi: ExtensionAPI | undefined;
  /** 已注册工具的定义签名；描述或 schema 变化时才重新注册。 */
  private signatures = new Map<string, string>();
  /** 上一次同步后的 MCP 激活名，用于判断集合是否变化。 */
  private activeNames: string[] = [];
  /** 是否成功设置过激活集合；加载阶段设置失败后必须重试。 */
  private activeSynced = false;
  /** 累计的命名冲突，供设置页展示。 */
  private conflicts: Array<{ fullName: string; skippedServerId: string }> = [];

  constructor(options: McpToolBridgeOptions) {
    this.runtime = options.runtime;
    this.log = options.log;
  }

  attach(pi: ExtensionAPI): void {
    this.pi = pi;
    this.sync();
  }

  detach(): void {
    this.pi = undefined;
  }

  isAttached(): boolean {
    return this.pi !== undefined;
  }

  listConflicts(): Array<{ fullName: string; skippedServerId: string }> {
    return this.conflicts.map((item) => ({ ...item }));
  }

  /** 重新对齐注册表与 runtime 的工具集；可在任意时刻调用。 */
  sync(): void {
    const pi = this.pi;
    if (!pi) return;

    const descriptors = this.runtime.listToolDescriptors();
    const accepted: McpToolDescriptor[] = [];
    const seen = new Set<string>();
    this.conflicts = [];

    for (const descriptor of descriptors) {
      if (seen.has(descriptor.fullName)) {
        // 两台服务器 sanitize 后撞名：先注册者胜，后来者的工具不进入激活集合。
        this.conflicts.push({ fullName: descriptor.fullName, skippedServerId: descriptor.serverId });
        this.log?.("warn", "MCP 工具名冲突，已跳过", {
          fullName: descriptor.fullName,
          serverId: descriptor.serverId,
        });
        continue;
      }
      seen.add(descriptor.fullName);
      accepted.push(descriptor);

      const signature = JSON.stringify([descriptor.description, descriptor.schema ?? null]);
      if (this.signatures.get(descriptor.fullName) !== signature) {
        pi.registerTool(this.definitionFor(descriptor));
        this.signatures.set(descriptor.fullName, signature);
      }
    }

    const nextNames = accepted.map((descriptor) => descriptor.fullName);
    const unchanged =
      this.activeSynced &&
      nextNames.length === this.activeNames.length &&
      nextNames.every((name, index) => name === this.activeNames[index]);
    if (!unchanged) {
      try {
        const preserved = pi.getActiveTools().filter((name) => !name.startsWith(MCP_TOOL_PREFIX));
        pi.setActiveTools([...preserved, ...nextNames]);
        this.activeNames = nextNames;
        this.activeSynced = true;
      } catch {
        // 扩展加载阶段（pi 尚未 bindCore）不允许调用 action 方法。
        // registerTool 已生效，SDK 首次构建工具集时会把新工具纳入激活集合；
        // 随后 session_start 会再次 sync，届时可以正常设置。
        this.activeSynced = false;
        this.log?.("info", "MCP 工具激活集合延后到会话启动时同步");
      }
    }
  }

  private definitionFor(descriptor: McpToolDescriptor): never {
    const runtime = this.runtime;
    const record = runtime.listRecords().find((item) => item.id === descriptor.serverId);
    const label = record?.label ?? descriptor.serverId;
    return {
      name: descriptor.fullName,
      label: `${label}: ${descriptor.toolName}`,
      description: descriptor.description,
      parameters: normalizeParameters(descriptor.schema),
      execute: async (_toolCallId: string, params: unknown, signal?: AbortSignal) => {
        if (signal?.aborted) throw new Error("操作已取消");
        const started = Date.now();
        try {
          const raw = await runtime.callTool(descriptor.fullName, params ?? {});
          return normalizeMcpResult(raw, {
            serverId: descriptor.serverId,
            toolName: descriptor.toolName,
            transport: record?.transport ?? "stdio",
            durationMs: Date.now() - started,
          });
        } catch (error) {
          // 统一错误文案：协议错误 / 超时 / 401 都在 describeMcpToolError 里归一化。
          throw new Error(describeMcpToolError(error), { cause: error });
        }
      },
    } as never;
  }
}

/** MCP 的 inputSchema 直接作为工具参数 schema；不合法时退化为空对象。 */
export function normalizeParameters(schema: unknown): Record<string, unknown> {
  if (schema && typeof schema === "object" && !Array.isArray(schema)) {
    const candidate = schema as Record<string, unknown>;
    if (candidate.type === "object") return candidate;
  }
  return { type: "object", properties: {} };
}
