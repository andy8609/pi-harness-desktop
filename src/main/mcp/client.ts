import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";
import { statSync } from "node:fs";
import { delimiter, isAbsolute, join, resolve, sep } from "node:path";
import {
  MCP_LIMITS,
  MCP_PROTOCOL_VERSION,
  type McpToolInfo,
  type McpTransport as McpTransportKind,
} from "@shared/mcp";

export type JsonRpcMessage = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
};

/** 两种传输被归约为「发一条消息、收一组消息」。 */
export type McpTransport = {
  send: (message: JsonRpcMessage) => Promise<void>;
  close: () => void;
};

export type McpTransportHandlers = {
  onMessage: (message: JsonRpcMessage) => void;
  onClose: (reason: string) => void;
};

export class McpError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "McpError";
    this.code = code;
  }
}

export type McpAuditEntry = Record<string, unknown>;

export type McpServerClientOptions = {
  /** 服务器 id，仅用于状态与审计。 */
  serverId: string;
  label?: string;
  transport: McpTransportKind;
  /** stdio：工作目录，同时是相对命令的基准（但用户命令必须是 PATH 名或绝对路径）。 */
  rootPath: string;
  command?: string;
  args?: string[];
  /** 已解析的 env（stdio）或 headers（http），不继承宿主环境。 */
  values: Record<string, string>;
  url?: string;
  audit?: (entry: McpAuditEntry) => void;
  connectTimeoutMs?: number;
  callTimeoutMs?: number;
  /** 测试注入点。 */
  spawnImpl?: typeof nodeSpawn;
  fetchImpl?: typeof fetch;
  /** 每次请求前校验 URL（重定向后复检）。 */
  assertUrlAllowed?: (url: string) => void;
};

/** stdio 子进程环境：只透传运行必需项 + 用户声明值，绝不继承宿主密钥。 */
export function mcpProcessEnv(values: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {
    NODE_ENV: process.env.NODE_ENV ?? "production",
  };
  for (const key of ["PATH", "Path", "SystemRoot", "SYSTEMROOT", "windir", "TEMP", "TMP", "TMPDIR", "LANG"]) {
    const value = process.env[key];
    if (value) env[key] = value;
  }
  return { ...env, ...values };
}

/**
 * 解析 stdio 可执行文件。
 *
 * 用户自行配置的服务器按 `trusted` 处理：允许 PATH 名或绝对路径，拒绝 `..` 段，
 * 既不经过 shell 也不做目录沙箱——与源项目「用户输入命令即授权」的语义一致。
 */
export function resolveMcpCommand(command: string): string {
  if (!/[\\/]/.test(command)) return command;
  if (command.split(/[\\/]/).some((part) => part === "..")) {
    throw new McpError("INVALID_ARGUMENT", `MCP 命令不能包含 "..": ${command}`);
  }
  if (!isAbsolute(command)) {
    throw new McpError("INVALID_ARGUMENT", `MCP 命令必须是 PATH 名或绝对路径: ${command}`);
  }
  return command;
}

/**
 * Windows 上 PATH 里的 `npx` / `npm` / `pnpm` / `yarn` 实际是 `.cmd` 批处理，
 * `CreateProcess` 无法直接执行，必须交给 `cmd.exe`。这里只对 `.cmd` / `.bat`
 * 做这层包装；`.exe` 与其它平台仍然直接 spawn，不引入 shell。
 */
export function resolveWindowsLauncher(
  command: string,
  args: string[],
): { command: string; args: string[]; viaCmd: boolean } {
  if (process.platform !== "win32") return { command, args, viaCmd: false };
  const found = findWindowsExecutable(command);
  if (!found) return { command, args, viaCmd: false };
  if (!found.batch) return { command: found.path, args, viaCmd: false };

  const comspec = process.env.ComSpec || "cmd.exe";
  const inner = [quoteWindowsArg(found.path), ...args.map(quoteWindowsArg)].join(" ");
  // /s /c 会把首尾引号剥掉；外层再包一层，保证含空格的路径整体被识别。
  return { command: comspec, args: ["/d", "/s", "/c", `"${inner}"`], viaCmd: true };
}

function findWindowsExecutable(command: string): { path: string; batch: boolean } | undefined {
  const hasExtension = /\.[a-z0-9]+$/i.test(command);
  const extensions = hasExtension
    ? [""]
    : (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean);
  const hasSeparator = command.includes("/") || command.includes(sep);
  const directories = hasSeparator ? [""] : (process.env.PATH ?? process.env.Path ?? "").split(delimiter);

  for (const directory of directories) {
    for (const extension of extensions) {
      const candidate = directory ? join(directory, `${command}${extension}`) : `${command}${extension}`;
      try {
        if (statSync(candidate).isFile()) {
          return { path: candidate, batch: /\.(cmd|bat)$/i.test(candidate) };
        }
      } catch {
        // 该候选不存在，继续找下一个
      }
    }
  }
  return undefined;
}

function quoteWindowsArg(value: string): string {
  // 换行会截断 cmd 命令行，直接拒绝（13=CR，10=LF）。
  if (value.includes(String.fromCharCode(13)) || value.includes(String.fromCharCode(10))) {
    throw new McpError("INVALID_ARGUMENT", "MCP 参数不能包含换行");
  }
  if (!/[\s"&|<>^()%!]/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

export function createStdioTransport(
  options: {
    rootPath: string;
    command: string;
    args: string[];
    env: Record<string, string>;
    spawnImpl?: typeof nodeSpawn;
  },
  handlers: McpTransportHandlers,
): McpTransport {
  const spawnImpl = options.spawnImpl ?? nodeSpawn;
  const launch = resolveWindowsLauncher(resolveMcpCommand(options.command), options.args);
  const child: ChildProcess = spawnImpl(launch.command, launch.args, {
    cwd: options.rootPath,
    env: options.env,
    stdio: ["pipe", "pipe", "pipe"],
    // 不经过 shell：参数保持字面量。cmd 包装时由我们显式拼好命令行。
    shell: false,
    ...(launch.viaCmd ? { windowsVerbatimArguments: true } : {}),
  });

  let closed = false;
  let buffer = "";
  let lastStderr = "";

  child.stdout?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    buffer += chunk;
    if (buffer.length > MCP_LIMITS.stdioLineBytes) {
      buffer = "";
      handlers.onClose("MCP 服务器发送了超大消息");
      child.kill();
      return;
    }
    let index = buffer.indexOf("\n");
    while (index >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (line) {
        try {
          handlers.onMessage(JSON.parse(line) as JsonRpcMessage);
        } catch {
          // 往 stdout 打日志的服务器违反传输约定，但一行脏数据不该拆掉可用会话。
        }
      }
      index = buffer.indexOf("\n");
    }
  });
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk: string) => {
    lastStderr = String(chunk).trimEnd().slice(-500);
  });
  child.on("error", (error: Error) => {
    closed = true;
    handlers.onClose(error.message);
  });
  child.on("exit", (code) => {
    closed = true;
    handlers.onClose(
      `MCP 服务器退出，退出码 ${code ?? 0}${lastStderr ? `：${lastStderr}` : ""}`,
    );
  });

  return {
    send: async (message) => {
      if (closed || !child.stdin?.writable) {
        throw new McpError("UNAVAILABLE", "MCP 服务器未在运行");
      }
      child.stdin.write(`${JSON.stringify(message)}\n`);
    },
    close: () => {
      closed = true;
      child.kill();
    },
  };
}

/** 解析 `text/event-stream` 响应体中的 JSON-RPC 事件。 */
export function parseSseMessages(body: string): JsonRpcMessage[] {
  const out: JsonRpcMessage[] = [];
  for (const block of body.split(/\n\n/)) {
    const data = block
      .split(/\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .join("");
    if (!data) continue;
    try {
      out.push(JSON.parse(data) as JsonRpcMessage);
    } catch {
      // 半个事件无法处理；请求会因超时失败。
    }
  }
  return out;
}

async function readBoundedHttpBody(response: Response): Promise<string> {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MCP_LIMITS.httpBodyBytes) {
    try {
      await response.body?.cancel();
    } catch {
      // 已确定拒绝，取消是尽力而为。
    }
    throw new McpError("LIMIT_EXCEEDED", "MCP 服务器响应过大");
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      bytes += value.byteLength;
      if (bytes > MCP_LIMITS.httpBodyBytes) {
        await reader.cancel();
        throw new McpError("LIMIT_EXCEEDED", "MCP 服务器响应过大");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}

function headersForMcpRequest(
  headers: Record<string, string>,
  initialUrl: string,
  currentUrl: string,
): Record<string, string> {
  if (new URL(initialUrl).origin === new URL(currentUrl).origin) return { ...headers };
  return {};
}

export function createHttpTransport(
  options: {
    url: string;
    headers: Record<string, string>;
    timeoutMs: number;
    fetchImpl?: typeof fetch;
    assertUrlAllowed?: (url: string) => void;
  },
  handlers: McpTransportHandlers,
): McpTransport {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new McpError("UNSUPPORTED", "当前运行时不支持 fetch，无法连接远程 MCP 服务器");
  }
  let closed = false;
  let sessionId: string | undefined;
  const activeControllers = new Set<AbortController>();

  return {
    send: async (message) => {
      if (closed) throw new McpError("UNAVAILABLE", "MCP 会话已关闭");
      const controller = new AbortController();
      activeControllers.add(controller);
      const timer = setTimeout(() => controller.abort(), options.timeoutMs);
      let url = options.url;
      try {
        for (let hop = 0; ; hop += 1) {
          options.assertUrlAllowed?.(url);
          const requestHeaders = headersForMcpRequest(options.headers, options.url, url);
          const currentOrigin = new URL(url).origin;
          const initialOrigin = new URL(options.url).origin;
          const response = await fetchImpl(url, {
            method: "POST",
            headers: {
              ...requestHeaders,
              "content-type": "application/json",
              accept: "application/json, text/event-stream",
              "mcp-protocol-version": MCP_PROTOCOL_VERSION,
              ...(currentOrigin === initialOrigin && sessionId
                ? { "mcp-session-id": sessionId }
                : {}),
            },
            body: JSON.stringify(message),
            redirect: "manual",
            signal: controller.signal,
          });
          if (response.status >= 300 && response.status <= 399) {
            const location = response.headers.get("location");
            try {
              await response.body?.cancel();
            } catch {
              // 重定向响应体不属于 MCP 结果。
            }
            if (!location) throw new McpError("HTTP_REDIRECT", "重定向缺少 location 头");
            if (hop >= MCP_LIMITS.redirects) {
              throw new McpError("HTTP_REDIRECT", `重定向次数过多：${options.url}`);
            }
            let nextUrl: URL;
            try {
              nextUrl = new URL(location, url);
            } catch {
              throw new McpError("HTTP_REDIRECT", `无效的重定向地址：${url}`);
            }
            if (nextUrl.protocol !== "http:" && nextUrl.protocol !== "https:") {
              throw new McpError("HTTP_REDIRECT", `不支持的重定向协议：${url}`);
            }
            if (nextUrl.origin !== initialOrigin) sessionId = undefined;
            url = nextUrl.toString();
            continue;
          }
          if (!response.ok) {
            try {
              await response.body?.cancel();
            } catch {
              // 状态码已足够构造错误。
            }
            throw new McpError("HTTP_ERROR", `MCP 服务器返回 ${response.status}`);
          }
          const nextSession = response.headers.get("mcp-session-id");
          if (nextSession && new URL(url).origin === initialOrigin) sessionId = nextSession;
          const contentType = response.headers.get("content-type") ?? "";
          const body = await readBoundedHttpBody(response);
          if (!body.trim()) return;
          const messages = contentType.includes("text/event-stream")
            ? parseSseMessages(body)
            : (() => {
                const parsed = JSON.parse(body) as JsonRpcMessage | JsonRpcMessage[];
                return Array.isArray(parsed) ? parsed : [parsed];
              })();
          for (const entry of messages) handlers.onMessage(entry);
          return;
        }
      } finally {
        clearTimeout(timer);
        activeControllers.delete(controller);
      }
    },
    close: () => {
      closed = true;
      for (const controller of activeControllers) controller.abort();
      activeControllers.clear();
      handlers.onClose("MCP 会话已关闭");
    },
  };
}

type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

/**
 * 一个 MCP 服务器连接。
 *
 * 只实现桌面端需要的 MCP 子集：`initialize`、`notifications/initialized`、
 * `tools/list`、`tools/call`。按需连接，对端死亡后由下次调用触发重连。
 */
export class McpServerClient {
  readonly serverId: string;
  readonly transportKind: McpTransportKind;
  private readonly options: McpServerClientOptions;
  private transport: McpTransport | null = null;
  private pending = new Map<number, Pending>();
  private nextId = 1;
  private tools: McpToolInfo[] = [];
  private connecting: Promise<McpToolInfo[]> | null = null;

  constructor(options: McpServerClientOptions) {
    this.options = options;
    this.serverId = options.serverId;
    this.transportKind = options.transport;
  }

  getTools(): McpToolInfo[] {
    return this.tools;
  }

  isConnected(): boolean {
    return this.transport !== null;
  }

  async connect(): Promise<McpToolInfo[]> {
    if (this.transport) return this.tools;
    if (this.connecting) return this.connecting;
    this.connecting = this.handshake().finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }

  async callTool(toolName: string, args: unknown): Promise<unknown> {
    await this.connect();
    const started = Date.now();
    try {
      const result = (await this.request(
        "tools/call",
        { name: toolName, arguments: args ?? {} },
        this.options.callTimeoutMs ?? MCP_LIMITS.callTimeoutMs,
      )) as { content?: unknown; isError?: boolean } | null;
      if (result && typeof result === "object" && result.isError) {
        throw new McpError("TOOL_FAILED", describeMcpContent(result.content) || "MCP 工具执行失败");
      }
      this.audit(true, toolName, Date.now() - started);
      return result ?? null;
    } catch (error) {
      this.audit(false, toolName, Date.now() - started, error);
      throw error;
    }
  }

  close(): void {
    const transport = this.transport;
    this.transport = null;
    this.tools = [];
    transport?.close();
    this.failPending(new McpError("UNAVAILABLE", "MCP 会话已关闭"));
  }

  private async handshake(): Promise<McpToolInfo[]> {
    const timeoutMs = this.options.connectTimeoutMs ?? MCP_LIMITS.connectTimeoutMs;
    const transport = this.createTransport(timeoutMs);
    this.transport = transport;
    try {
      await this.request(
        "initialize",
        {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: "Pi Desktop", version: "1" },
        },
        timeoutMs,
      );
      await transport.send({ jsonrpc: "2.0", method: "notifications/initialized" });
      this.tools = await this.listTools(timeoutMs);
      this.options.audit?.({
        api: "mcp.connect",
        ok: true,
        serverId: this.serverId,
        transport: this.transportKind,
        toolCount: this.tools.length,
        ts: Date.now(),
      });
      return this.tools;
    } catch (error) {
      this.transport = null;
      this.tools = [];
      transport.close();
      this.failPending(new McpError("UNAVAILABLE", "MCP 握手失败"));
      this.options.audit?.({
        api: "mcp.connect",
        ok: false,
        serverId: this.serverId,
        transport: this.transportKind,
        errorCode: error instanceof McpError ? error.code : "MCP_CONNECT_FAILED",
        message: (error as Error).message,
        ts: Date.now(),
      });
      throw error;
    }
  }

  private createTransport(timeoutMs: number): McpTransport {
    const handlers: McpTransportHandlers = {
      onMessage: (message) => this.receive(message),
      onClose: (reason) => {
        this.transport = null;
        this.tools = [];
        this.failPending(new McpError("UNAVAILABLE", reason));
      },
    };
    if (this.options.transport === "stdio") {
      return createStdioTransport(
        {
          rootPath: this.options.rootPath,
          command: String(this.options.command ?? ""),
          args: this.options.args ?? [],
          env: mcpProcessEnv(this.options.values),
          spawnImpl: this.options.spawnImpl,
        },
        handlers,
      );
    }
    return createHttpTransport(
      {
        url: String(this.options.url ?? ""),
        headers: this.options.values,
        timeoutMs,
        fetchImpl: this.options.fetchImpl,
        assertUrlAllowed: this.options.assertUrlAllowed,
      },
      handlers,
    );
  }

  private async listTools(timeoutMs: number): Promise<McpToolInfo[]> {
    const collected: McpToolInfo[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < MCP_LIMITS.toolPages; page += 1) {
      const result = (await this.request(
        "tools/list",
        cursor ? { cursor } : {},
        timeoutMs,
      )) as { tools?: unknown; nextCursor?: unknown } | null;
      const tools = Array.isArray(result?.tools) ? result.tools : [];
      for (const raw of tools as Array<Record<string, unknown>>) {
        const name = typeof raw?.name === "string" ? raw.name.trim() : "";
        if (!name) continue;
        if (collected.some((tool) => tool.name === name)) continue;
        if (collected.length >= MCP_LIMITS.toolsPerServer) {
          this.options.audit?.({
            api: "mcp.tools.truncated",
            ok: false,
            errorCode: "LIMIT_EXCEEDED",
            serverId: this.serverId,
            limit: MCP_LIMITS.toolsPerServer,
            ts: Date.now(),
          });
          return collected;
        }
        collected.push({
          name,
          description: typeof raw.description === "string" ? raw.description : undefined,
          inputSchema: raw.inputSchema,
        });
      }
      const next = typeof result?.nextCursor === "string" ? result.nextCursor : "";
      if (!next || next === cursor) return collected;
      cursor = next;
    }
    return collected;
  }

  private request(method: string, params: unknown, timeoutMs: number): Promise<unknown> {
    const transport = this.transport;
    if (!transport) {
      return Promise.reject(new McpError("UNAVAILABLE", "MCP 服务器未连接"));
    }
    const id = this.nextId++;
    return new Promise<unknown>((resolvePromise, rejectPromise) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        rejectPromise(new McpError("TIMEOUT", `MCP ${method} 超时（${timeoutMs}ms）`));
      }, timeoutMs);
      this.pending.set(id, { resolve: resolvePromise, reject: rejectPromise, timer });
      void transport.send({ jsonrpc: "2.0", id, method, params }).catch((error: Error) => {
        const entry = this.pending.get(id);
        if (!entry) return;
        this.pending.delete(id);
        clearTimeout(entry.timer);
        rejectPromise(error);
      });
    });
  }

  private receive(message: JsonRpcMessage): void {
    if (message.id !== undefined && message.id !== null && message.method) {
      // 桌面端不提供服务器发起的任何能力；回一个明确错误，避免对端一直等。
      void this.transport
        ?.send({
          jsonrpc: "2.0",
          id: message.id,
          error: { code: -32601, message: "method not supported" },
        })
        .catch(() => undefined);
      return;
    }
    if (typeof message.id !== "number") return;
    const entry = this.pending.get(message.id);
    if (!entry) return;
    this.pending.delete(message.id);
    clearTimeout(entry.timer);
    if (message.error) {
      entry.reject(
        new McpError("MCP_ERROR", message.error.message || `MCP 错误 ${message.error.code ?? ""}`),
      );
      return;
    }
    entry.resolve(message.result ?? null);
  }

  private failPending(error: Error): void {
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    this.pending.clear();
  }

  private audit(ok: boolean, toolName: string, durationMs: number, error?: unknown): void {
    this.options.audit?.({
      api: "mcp.call",
      ok,
      serverId: this.serverId,
      transport: this.transportKind,
      tool: toolName,
      durationMs,
      ...(ok
        ? {}
        : {
            errorCode: error instanceof McpError ? error.code : "MCP_CALL_FAILED",
            message: (error as Error)?.message,
          }),
      ts: Date.now(),
    });
  }
}

/** 把 MCP content 拍平成短文本，仅用于错误提示。 */
export function describeMcpContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => {
      if (block && typeof block === "object" && typeof (block as { text?: unknown }).text === "string") {
        return (block as { text: string }).text;
      }
      return "";
    })
    .filter(Boolean)
    .join("\n")
    .slice(0, 500);
}

/** 供 runtime 判断是否是 URL 层错误。 */
export function isHttpStatusError(error: unknown, status: number): boolean {
  return error instanceof McpError && error.message.includes(String(status));
}
