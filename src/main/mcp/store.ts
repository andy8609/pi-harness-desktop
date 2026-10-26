import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  MCP_LIMITS,
  cloneMcpServerRecord,
  normalizeMcpServerInput,
  normalizeScope,
  type McpFile,
  type McpScope,
  type McpServerInput,
  type McpServerRecord,
} from "@shared/mcp";

export type McpStoreLogger = (level: "info" | "warn" | "error", message: string, data?: unknown) => void;

export interface McpStoreOptions {
  filePath: string;
  now?: () => string;
  log?: McpStoreLogger;
}

/**
 * MCP 服务器配置的持久化层。
 *
 * 只做「文件 ↔ 记录」：校验、原子写、损坏备份、增删改查。连接与调用在
 * `runtime.ts`，因此本类可以被 Node 测试直接驱动（不 import electron）。
 *
 * 文件损坏时的策略：把原文件重命名为 `.corrupt-<时间戳>.json` 后以空配置启动，
 * 让用户至少能打开应用并修配置，而不是启动即失败。
 */
export class McpStore {
  private readonly filePath: string;
  private readonly now: () => string;
  private readonly log?: McpStoreLogger;
  private servers: McpServerRecord[] = [];

  constructor(options: McpStoreOptions) {
    this.filePath = options.filePath;
    this.now = options.now ?? (() => new Date().toISOString());
    this.log = options.log;
    this.load();
  }

  /** 从磁盘加载；可重复调用（外部改文件后刷新）。 */
  load(): McpServerRecord[] {
    this.servers = [];
    if (!existsSync(this.filePath)) return this.list();

    let raw: string;
    try {
      raw = readFileSync(this.filePath, "utf8");
    } catch (error) {
      this.log?.("error", "读取 MCP 配置失败", { file: this.filePath, error: String(error) });
      return this.list();
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      this.backupCorrupt();
      return this.list();
    }

    const file = parsed as Partial<McpFile> | null;
    if (!file || typeof file !== "object" || !Array.isArray(file.servers)) {
      this.backupCorrupt();
      return this.list();
    }

    for (const candidate of file.servers) {
      const result = normalizeMcpServerInput(candidate as Partial<McpServerInput>, {
        now: this.now(),
        createdAt: typeof (candidate as McpServerRecord)?.createdAt === "string"
          ? (candidate as McpServerRecord).createdAt
          : undefined,
      });
      if (!result.ok) {
        this.log?.("warn", "跳过不合法的 MCP 服务器配置", {
          id: (candidate as { id?: unknown })?.id,
          error: result.error,
        });
        continue;
      }
      if (this.servers.some((server) => server.id === result.server.id)) {
        this.log?.("warn", "跳过重复 id 的 MCP 服务器配置", { id: result.server.id });
        continue;
      }
      this.servers.push(result.server);
      if (this.servers.length >= MCP_LIMITS.servers) break;
    }
    return this.list();
  }

  list(): McpServerRecord[] {
    return this.servers.map((server) => cloneMcpServerRecord(server));
  }

  get(id: string): McpServerRecord | undefined {
    const found = this.servers.find((server) => server.id === id);
    return found ? cloneMcpServerRecord(found) : undefined;
  }

  /** 新增或覆盖同 id 记录。 */
  upsert(input: Partial<McpServerInput>): McpServerRecord {
    const existing = this.servers.find((server) => server.id === (input?.id ?? "").trim());
    const result = normalizeMcpServerInput(input, {
      now: this.now(),
      createdAt: existing?.createdAt,
    });
    if (!result.ok) throw new Error(result.error);

    const next = result.server;
    if (existing) {
      this.servers = this.servers.map((server) => (server.id === next.id ? next : server));
    } else {
      if (this.servers.length >= MCP_LIMITS.servers) {
        throw new Error(`MCP 服务器数量已达上限 ${MCP_LIMITS.servers}`);
      }
      this.servers = [...this.servers, next];
    }
    this.save();
    return cloneMcpServerRecord(next);
  }

  remove(id: string): boolean {
    const before = this.servers.length;
    this.servers = this.servers.filter((server) => server.id !== id);
    if (this.servers.length === before) return false;
    this.save();
    return true;
  }

  setEnabled(id: string, enabled: boolean): McpServerRecord {
    return this.patch(id, { enabled });
  }

  setScope(id: string, scope: McpScope): McpServerRecord {
    return this.patch(id, { scope: normalizeScope(scope) });
  }

  /** 工具级开关：`enabled=true` 从禁用列表移除，`false` 加入。 */
  setToolEnabled(id: string, toolName: string, enabled: boolean): McpServerRecord {
    const current = this.require(id);
    const name = toolName.trim();
    if (!name) throw new Error("toolName 不能为空");
    const disabled = new Set(current.disabledTools ?? []);
    if (enabled) disabled.delete(name);
    else disabled.add(name);
    return this.patch(id, { disabledTools: [...disabled].slice(0, MCP_LIMITS.disabledTools) });
  }

  private patch(id: string, patch: Partial<McpServerInput>): McpServerRecord {
    const current = this.require(id);
    return this.upsert({
      ...current,
      ...patch,
      id: current.id,
      transport: current.transport,
      command: current.command,
      args: current.args,
      env: current.env,
      url: current.url,
      headers: current.headers,
    });
  }

  private require(id: string): McpServerRecord {
    const found = this.servers.find((server) => server.id === id);
    if (!found) throw new Error(`MCP 服务器不存在: ${id}`);
    return cloneMcpServerRecord(found);
  }

  /** 原子写：先写临时文件再 rename，避免半截 JSON。 */
  private save(): void {
    const file: McpFile = { version: 1, servers: this.servers };
    const payload = `${JSON.stringify(file, null, 2)}\n`;
    const temp = `${this.filePath}.tmp`;
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
      writeFileSync(temp, payload, "utf8");
      renameSync(temp, this.filePath);
    } catch (error) {
      this.log?.("error", "写入 MCP 配置失败", { file: this.filePath, error: String(error) });
      throw new Error(`写入 MCP 配置失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private backupCorrupt(): void {
    const stamp = this.now().replace(/[:.]/g, "-");
    const target = `${this.filePath}.corrupt-${stamp}.json`;
    try {
      copyFileSync(this.filePath, target);
      this.log?.("warn", "MCP 配置文件损坏，已备份", { file: this.filePath, backup: target });
    } catch (error) {
      this.log?.("error", "备份损坏的 MCP 配置失败", { file: this.filePath, error: String(error) });
    }
  }
}

