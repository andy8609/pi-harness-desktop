# T9 MCP IPC / preload 契约

> 通道域：`mcp:`；全部 `ipcMain.handle` + `ipcRenderer.invoke`；错误统一为 `Error(message)`（`wrap()` 归一化）。
> 事件通道：`mcp:changed`（主进程 → 渲染进程推送完整快照）。

## 1. 数据类型

```ts
type McpTransport = "stdio" | "http";
type McpConnectionState = "idle" | "connecting" | "ready" | "failed";

interface McpScope { mode: "global" | "projects"; projects: string[] }

interface McpServerRecord {
  id: string; label: string; description?: string;
  transport: McpTransport;
  command?: string; args?: string[]; env?: Record<string, string>;
  url?: string; headers?: Record<string, string>;
  enabled: boolean; scope: McpScope;
  disabledTools?: string[];
  createdAt: string; updatedAt: string;
}

interface McpServerInput { /* 同上去掉 createdAt/updatedAt，字段可省略，enabled/scope 有默认值 */ }

interface McpServerStatus {
  serverId: string; state: McpConnectionState; toolCount: number;
  toolNames?: string[]; message?: string; updatedAt: number;
  authRequired?: boolean; truncated?: boolean;
}

interface McpSnapshot { servers: McpServerRecord[]; statuses: McpServerStatus[] }
interface McpToolView { name: string; description?: string; enabled: boolean }
```

## 2. 通道清单

| 通道 | 入参 | 出参 | 说明 |
|---|---|---|---|
| `mcp:list` | — | `McpSnapshot` | 配置 + 当前状态（含未启用服务器） |
| `mcp:upsert` | `McpServerInput` | `{ server, cancelled? }` | 新增/覆盖；保存后自动握手。`cancelled: true` 表示 stdio 授权被拒绝并已回滚 |
| `mcp:remove` | `{ id }` | `{ removed: boolean }` | 删除配置并断开 |
| `mcp:setEnabled` | `{ id, enabled }` | `{ server }` | 启用后异步握手；禁用则立即断开 |
| `mcp:setScope` | `{ id, scope }` | `{ server }` | global / projects |
| `mcp:test` | `{ id }` | `{ status }` | 强制重新握手（连接成功则保留） |
| `mcp:reconnect` | `{ id }` | `{ status }` | 同 test，UI 文案区分 |
| `mcp:disconnect` | `{ id }` | `{ ok: boolean }` | 关闭连接并清空工具缓存 |
| `mcp:listTools` | `{ id }` | `{ tools: McpToolView[] }` | 最近一次握手的工具 + 启停状态 |
| `mcp:setToolEnabled` | `{ id, toolName, enabled }` | `{ server }` | 工具级开关，立即刷新注册表 |
| `mcp:refresh` | — | `McpSnapshot` | 重新读盘（外部编辑配置文件后） |

## 3. 事件

`mcp:changed`，payload = `McpSnapshot`。

触发时机（合并 50 ms 内的连续变化）：
- 任何配置变更（upsert/remove/setEnabled/setScope/setToolEnabled/refresh）
- 连接状态变化（connecting → ready / failed）
- 工具集变化（握手完成、断开、工具级开关）

preload 用法：

```ts
const off = window.pi.onMcpChanged((snapshot) => setSnapshot(snapshot));
// 卸载时调用 off()
```

## 4. preload API（`window.pi`）

```ts
mcpList(): Promise<McpSnapshot>
mcpUpsert(input: McpServerInput): Promise<{ server: McpServerRecord; cancelled?: boolean }>
mcpRemove(id: string): Promise<{ removed: boolean }>
mcpSetEnabled(id: string, enabled: boolean): Promise<{ server: McpServerRecord }>
mcpSetScope(id: string, scope: McpScope): Promise<{ server: McpServerRecord }>
mcpTest(id: string): Promise<{ status: McpServerStatus }>
mcpReconnect(id: string): Promise<{ status: McpServerStatus }>
mcpDisconnect(id: string): Promise<{ ok: boolean }>
mcpListTools(id: string): Promise<{ tools: McpToolView[] }>
mcpSetToolEnabled(id: string, toolName: string, enabled: boolean): Promise<{ server: McpServerRecord }>
mcpRefresh(): Promise<McpSnapshot>
onMcpChanged(listener: (snapshot: McpSnapshot) => void): () => void
```

`src/preload/index.d.ts` 已包含与实现一致的签名，渲染层无需 `any` 断言。

## 5. 装配点

| 位置 | 作用 |
|---|---|
| `src/main/mcp/service.ts` | 门面：store + runtime + bridge，所有 IPC 方法落在这里 |
| `src/main/mcp/ipc.ts` | 通道注册（`registerMcpIpc`） |
| `src/main/ipc.ts` | `registerIpc(host, dialogs, mcp?)` 末尾调用 `registerMcpIpc` |
| `src/main/index.ts` | 构造 `McpService`（`~/.pi/agent/mcp-servers.json`）、注入 `host.setMcp`、广播快照、退出清理 |
| `src/main/agent-host.ts` | `createFactory` 注入 MCP 扩展；`openProject` 更新项目路径并触发连接；`dispose` 关闭连接 |

## 6. 与源项目 IPC 的差异

| 源项目 | 本次 | 原因 |
|---|---|---|
| `mcp.list/upsert/remove/setEnabled/setScope/transfer/test` 走 host-core RPC | 直接调用 main 内 `McpService` | 无 host-core |
| `mcpImport` / `mcpMarketSearch` / `mcpOauthStart` / `mcpOauthCancel` | 未提供 | 范围决策 D13 |
| `pluginChanged` 事件 | `mcp:changed` 专通道 | 语义更窄，避免 UI 全量刷新 |
