# T1 MCP 迁移基线清单（源项目 PI-Desktop-main）

> 源仓库：`D:\test\PI-Desktop-main`（pnpm monorepo + Rust `host-core`）
> 盘点方式：只读检查，未改动源项目任何文件。
> 目标仓库：`D:/project/pi-harness-desktop`（electron-vite + React + pi-coding-agent SDK）

## 1. 结论摘要

1. **源项目没有使用 `@modelcontextprotocol/sdk`**，而是自研了一个约 680 行的 MCP JSON-RPC 客户端（`plugin-mcp.ts`），只实现 `initialize` / `notifications/initialized` / `tools/list` / `tools/call` 四个方法。迁移时可直接移植，不需要引入第三方 SDK。
2. 传输层只有两种：**stdio**（`child_process.spawn`，按行分隔 JSON-RPC）与 **http**（Streamable HTTP：POST JSON-RPC，响应可为 `application/json` 或 `text/event-stream`）。源项目**没有**独立的旧式 SSE（GET 长连接）传输。
3. 配置记录由 Rust `host-core` 持有，落盘为 `.agents/servers/<id>.json`（全局 `~/.agents/servers`，项目级 `<project>/.agents/servers`）；激活状态（enabled/scope）由应用本地 capability state 管理，**不写进配置文件**。
4. 「配置 → 连接 → 工具注册 → 工具调用」链路在 Electron 主进程内完成；工具以 `mcp_<serverId>_<toolName>` 命名注入会话。
5. 增强项现状：**OAuth 存在**（`mcp-oauth.ts`，DCR + PKCE + 本机回调）；**工具级开关不存在**（只有 server 级 enabled）；**首次连接/stdio 命令授权确认不存在**（用户手工输入命令即视为授权）。
6. 另有「反向 MCP 控制服务器」（`mcp-control.ts`）把桌面能力暴露成 MCP server 给外部客户端，属于 MCP 生态扩展能力，**不在本次迁移范围**。

## 2. 源项目文件清单与职责

### 2.1 主进程运行时

| 路径 | 行数 | 职责 |
|---|---|---|
| `apps/desktop/electron/main/plugin-mcp.ts` | 678 | **核心客户端**。`McpServerClient`：JSON-RPC 请求/响应表、`initialize` 握手、`tools/list` 分页、`tools/call`、超时、审计；`createStdioTransport` / `createHttpTransport`；`mcpProcessEnv`（env 白名单）；`resolveMcpCommand`（confined/trusted 命令策略）；`describeMcpContent` |
| `apps/desktop/electron/main/user-mcp.ts` | 422 | **用户服务器运行时**。`UserMcpRuntime`：记录采纳（`setRecords`）、状态机（idle/connecting/ready/failed）、按项目激活过滤、工具描述符生成（`mcp_<server>_<tool>`）、`callTool` 路由与二次校验、`test()` 强制重握手、`invalidate` / `disposeAll`、`configurationChanged`；活跃服务器上限 16 |
| `apps/desktop/electron/main/mcp-oauth.ts` | 874 | **OAuth（增强项）**。元数据发现、动态客户端注册、PKCE、本机 loopback 回调服务器、token 存取与刷新、`hasOAuth` / `deleteOAuth` / `transferOAuth`、HTML 回调页 |
| `apps/desktop/electron/main/mcp-registry-catalog.ts` | 470 | 官方 MCP Registry 与市场目录搜索（网络 + 映射），非核心链路 |
| `apps/desktop/electron/main/ipc/mcp-ipc.ts` | 219 | **IPC 契约**：`mcpList` / `mcpUpsert` / `mcpRemove` / `mcpSetEnabled` / `mcpSetScope` / `mcpTransfer` / `mcpTest` / `mcpOauthStart` / `mcpOauthCancel` / `mcpImport` / `mcpMarketSearch` |
| `apps/desktop/electron/main/importers/agent-mcp-scan.ts` | — | 扫描 Claude Desktop / Claude Code / Cursor / Codex / opencode / ChatGPT 配置，产出导入候选 |
| `apps/desktop/electron/main/mcp-control.ts` | 1258 | 反向 MCP 控制服务器（对外暴露桌面能力）。**排除本次迁移** |
| `apps/desktop/electron/main/plugin-mcp.ts` 使用方 | — | `plugin-runtime.ts` / `services/plugin-services.ts` 把插件声明的 MCP server 接到同一客户端 |

### 2.2 共享与持久化

| 路径 | 职责 |
|---|---|
| `packages/shared/src/types/capabilities.ts` | `McpTransport = "stdio" \| "http"`、`McpServerRecord`、`McpServerInput`、`McpServerStatus`、`McpConnectionState` |
| `packages/shared/src/activation.ts` | `ActivationScope`（global / projects）、`isActiveInProject`、`resolveScope` |
| `packages/shared/src/mcp-import.ts` | 粘贴配置解析：`{mcpServers:{...}}`、裸 map、单对象；按 `command`/`url` 推断传输；非法项进 `skipped` |
| `packages/shared/src/mcp-catalog.ts`、`mcp-catalog-builtin.ts`、`mcp-registry.ts` | 市场模板、内置目录、官方 Registry 适配（增强项） |
| `packages/plugin-sdk/src/mcp-config.ts` | 插件侧 MCP 声明校验：id/env key/header key 正则、相对路径与 `..` 拒绝、loopback 识别 |
| `packages/plugin-sdk/src/index.ts`（`userMcpToolName`） | 工具名映射：`mcp_<safeServerId>_<safeToolName>`，非 `[A-Za-z0-9_]` 字符替换为 `_` |
| `crates/host-core/src/mcp_servers.rs` | 记录 CRUD 与校验：`MAX_SERVERS=128`、`MAX_ARGS=64`、`MAX_ENV_ENTRIES=64`、`MAX_HEADERS=32`、`MAX_VALUE_BYTES=4096`；落盘 `.agents/servers/<id>.json` |

### 2.3 渲染进程 UI

| 路径 | 职责 |
|---|---|
| `apps/desktop/src/components/settings/AgentMcpPage.tsx` | MCP 管理页：全局/项目分组、搜索、状态徽标、启用开关、测试连接、编辑/删除、市场入口 |
| `apps/desktop/src/components/extensions/McpEditorSheet.tsx` | 新增/编辑抽屉：`McpDraft`、`emptyMcpDraft`、`draftFromRecord`、`draftToInput`、`splitArgs`（引号感知）、KeyValue 行编辑、传输切换 |
| `apps/desktop/src/components/extensions/KeyValueRows.tsx` | env / headers 键值行编辑器 |
| `apps/desktop/src/components/extensions/ScopeControl.tsx` | 全局 / 指定项目范围控件 |
| `apps/desktop/src/components/settings/AgentCapabilityLayout.tsx` | 能力页通用布局、行菜单、删除确认、搜索匹配 |
| `apps/desktop/src/components/settings/McpMarketPanel.tsx` | MCP 市场面板（增强项） |

## 3. 配置 Schema 样例

### 3.1 落盘格式（`.agents/servers/<id>.json`，camelCase）

stdio：

```json
{
  "id": "filesystem",
  "label": "Filesystem",
  "description": "Local file access",
  "transport": "stdio",
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-filesystem", "D:/work"],
  "env": { "LOG_LEVEL": "info" }
}
```

http（Streamable HTTP）：

```json
{
  "id": "remote-docs",
  "label": "Remote Docs",
  "transport": "http",
  "url": "https://mcp.example.com/mcp",
  "headers": { "X-API-Key": "..." }
}
```

> 源项目没有独立 SSE 传输。若服务端地址形如 `https://host/sse`，源项目仍以 Streamable HTTP 方式 POST（服务端若只支持旧式 SSE GET 则不可用）。迁移到当前项目时沿用该行为，并在 UI 标注「Streamable HTTP」。

运行时记录（内存/IPC 视图）额外字段：`level`（global/project）、`projectPath`、`path`、`enabled`、`scope`、`createdAt`、`updatedAt`。

### 3.2 连接状态

```ts
type McpConnectionState = "idle" | "connecting" | "ready" | "failed";
type McpServerStatus = {
  serverId: string;
  state: McpConnectionState;
  toolCount: number;
  toolNames?: string[];
  message?: string;
  updatedAt: number;
  hasOauth?: boolean;
  authRequired?: boolean;
};
```

## 4. 传输层与版本事实

| 项 | 值 |
|---|---|
| MCP 协议版本（`initialize` 声明） | `2025-06-18` |
| 连接超时 | 10_000 ms |
| 调用超时 | 100_000 ms |
| 单服务器工具上限 | 64 |
| `tools/list` 分页上限 | 8 页 |
| stdio 单行上限 | 4 MiB |
| HTTP 响应体上限 | 4 MiB |
| HTTP 重定向上限 | 5 跳（跨 origin 丢弃 session id 与自定义 headers） |
| SDK | 无第三方 MCP SDK |
| HTTP 客户端 | 全局 `fetch`（Node 22 / Electron 37 内置） |
| stdio | `node:child_process.spawn`，`shell: false`，逐行 NDJSON |
| 环境变量策略 | 只透传 `PATH`/`SystemRoot`/`windir`/`TEMP`/`TMP`/`TMPDIR`/`LANG` + `NODE_ENV` + 用户声明值；不继承宿主 provider key |
| 命令策略 | 用户服务器用 `trusted`：允许 PATH 名或绝对路径，禁止 `..`；插件服务器用 `confined`：必须落在插件目录内 |

## 5. 调用链路

```
配置读取 (.agents/servers/*.json + capability state)
        │
        ▼
UserMcpRuntime.setRecords(records)
        │  按 project 过滤 isActiveInProject → 最多 16 个
        ▼
connect(record) ──► McpServerClient.connect()
        │                ├─ stdio: spawn(command, args, env白名单) ── NDJSON
        │                └─ http : POST url (json-rpc, mcp-protocol-version 头)
        │                ├─ initialize  → notifications/initialized
        │                └─ tools/list（游标分页，≤64 个）
        ▼
UserMcpToolDescriptor[] = { fullName: mcp_<server>_<tool>, description, schema }
        │
        ▼
会话装配：把描述符加入模型的工具列表（宿主侧注入）
        │
        ▼
模型调用 mcp_<server>_<tool>(args)
        │
        ▼
UserMcpRuntime.callTool(fullName, args, projectPath)
        ├─ findTool（缓存中不存在 → TOOL_NOT_FOUND）
        ├─ 校验记录仍存在且对该项目激活
        ├─ 必要时 connect（配置变化则重握手）
        ├─ 校验新握手中仍声明该工具
        └─ McpServerClient.callTool → tools/call
             ├─ isError → TOOL_FAILED（拼接 content.text，≤500 字）
             ├─ 401 → 状态置 failed + authRequired
             └─ 成功 → 原样返回 result（content / structuredContent）
```

关键行为约定（迁移必须保留）：

- **不重试 `tools/call`**（失败响应可能已产生副作用）。
- 单服务器握手失败只记录状态，不抛出、不阻塞会话装配与其它服务器。
- 已失败（failed）的服务器在本次运行内**不重复握手**，直到用户编辑配置或点击测试。
- 断开后 `transport=null`、`tools=[]`，但 `discoveredTools` 保留为路由提示；派发前必须用新握手列表复核。
- 服务器发起的请求（带 `id` 且有 `method`）一律回 `-32601 method not supported`。
- 编辑配置触发 `configurationChanged` 时立即关闭旧连接；仅 label/description/scope 变化不重连。

## 6. 增强项现状

| 增强项 | 源项目现状 | 位置 | 迁移建议 |
|---|---|---|---|
| OAuth（远程 HTTP） | **有**。元数据发现 → DCR → PKCE → loopback 回调 → token 存取/刷新；401 时标记 `authRequired` | `mcp-oauth.ts`、`user-mcp.ts`（`getValidAccessToken`）、`mcp-ipc.ts` | 迁移连接层时预留 token 注入钩子（`Authorization: Bearer`），OAuth 本体在 T13 按当前项目凭证存储能力落地 |
| 授权确认（stdio/首次连接） | **无**。用户键入命令即视为授权 | — | T13 若源项目无对应实现，降级为「新增/启用 stdio 服务器时显式确认」最小流程 |
| 工具级开关 | **无**。仅 server 级 `enabled` | `AgentMcpPage.tsx` 只有服务器开关 | T12 为实现项；需要新增 `toolOverrides` 配置字段 |
| 市场 / Registry 导入 | **有** | `mcp-registry-catalog.ts`、`McpMarketPanel.tsx`、`agent-mcp-scan.ts` | 不在本次范围 |
| 粘贴导入 | **有** | `mcp-import.ts`、`mcp-ipc.ts#mcpImport` | 低成本可保留为增强；本计划暂不纳入必做 |

## 7. 与目标项目的关键差异（供 T3 决策）

| 差异点 | 源项目 | 当前项目 |
|---|---|---|
| 配置存储 | Rust `host-core` + `.agents/servers/*.json` + capability state | 无 host-core；JSON 偏好文件（`desktop-prefs.json` 模式） |
| 工具注入 | 宿主自定义机制，会话装配时合并工具描述符 | pi-coding-agent SDK：`pi.registerTool()`（extension factory）或 `customTools` |
| IPC | 自研 `IpcRegistrar` + 白名单通道 | `ipcMain.handle("app:*")` + preload `window.pi` |
| 渲染层 | i18next + 自研 Capability 布局 | React + zustand + Tailwind + `components/ui` |
| 打包 | electron-builder（monorepo） | electron-builder + electron-vite，`externalizeDepsPlugin` |
| 模块系统 | monorepo ESM/TS | `"type": "module"`，main/preload 由 electron-vite 打包 |

## 8. 迁移取舍基线（T3 输入）

- **直接移植**：`plugin-mcp.ts`（客户端 + 两传输）、`user-mcp.ts`（运行时状态机）、`userMcpToolName` 命名规则、`mcpProcessEnv`、`resolveMcpCommand("trusted")`、限制常量。
- **重写适配**：配置存储（JSON 文件替代 host-core）、工具注入（SDK `registerTool` 替代宿主合并）、IPC / preload / UI（当前项目风格）。
- **可选/延后**：OAuth（T13）、工具级开关（T12）、粘贴导入、市场/Registry、第三方配置扫描、反向 MCP 控制服务器（排除）。
