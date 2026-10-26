# T2 当前项目架构与 MCP 集成点勘察

> 目标仓库：`D:/project/pi-harness-desktop`
> 版本事实：Node v22.23.2、Electron 37.3.1、electron-vite 4.0.0、Vite 7.1.5、TS 5.9.2、`"type": "module"`
> 基线验证：`npm run build` 通过（main 156 kB / preload 5.5 kB / renderer 1.35 MB）

## 1. 「当前无 MCP 实现」核查结论

对 `src/`、`electron.vite.config.ts`、`package.json`、`README.md`、`USAGE.md` 全量检索 `mcp`（忽略大小写）：**0 命中**。
package.json 依赖中没有 `@modelcontextprotocol/*`。

→ 本次为纯新增，不存在与既有 MCP 代码的冲突；也不需要替换逻辑。

## 2. 五类集成点与落地位置

| 集成点 | 当前实现 | MCP 新增位置 |
|---|---|---|
| 配置存储 | `src/main/prefs.ts`：`app.getPath("userData")/desktop-prefs.json`，`loadPrefs/savePrefs` 同步读写、无 schema 校验 | `src/main/mcp/store.ts`：`~/.pi/agent/mcp-servers.json`，带校验与原子写；类型放 `src/shared/mcp.ts` |
| 连接管理 | 无 | `src/main/mcp/client.ts`（移植 `plugin-mcp.ts`）、`src/main/mcp/runtime.ts`（移植 `user-mcp.ts`） |
| 工具注册中心 | `src/main/agent-host.ts#createFactory` 通过 `createAgentSessionServices({ resourceLoaderOptions: { extensionFactories: [...] } })` 注入内联扩展；扩展用 `pi.registerTool()` 注册工具（实例：`src/main/extensions/gpa.ts` 的 `request_user_input`） | `src/main/extensions/mcp.ts`：extension factory，持有 `ExtensionAPI` 引用，按 runtime 工具清单动态 `registerTool` + `setActiveTools` |
| IPC 通道 | `src/main/ipc.ts#registerIpc`，统一 `ipcMain.handle("<域>:<动作>")`；域有 `app:`、`fs:`、`dialog:`；`wrap()` 统一错误转 message | 在 `registerIpc` 内追加 `mcp:` 域通道（见第 5 节） |
| preload API | `src/preload/index.ts` 构造 `api` 对象并 `contextBridge.exposeInMainWorld("pi", api)`；事件用 `onXxx(listener) => unsubscribe` 模式 | `api.mcp*` 方法 + `api.onMcpChanged(listener)` |
| UI | `src/renderer/src/components/SettingsPage.tsx`：`GROUPS` 左侧导航 + `SectionCard` 内容区；`src/renderer/src/components/ui/index.ts` 导出 Button/Badge/Field/Switch/Modal/EmptyState/Skeleton/SegmentedControl | `GROUPS` 增加 `mcp` 分组；新增 `components/mcp/McpSettingsPanel.tsx`、`McpServerDialog.tsx` |
| 事件推送 | 主进程 `window.webContents.send("session:event" \| "catalog:updated" \| "dialog:request")`；`src/main/event-pump.ts` 做节流广播 | 新增 `"mcp:changed"` 通道，payload `{ servers, statuses }` |
| 生命周期清理 | `src/main/index.ts#before-quit` → `host.dispose()`；`AgentHost#dispose` 释放 runtime/watchdog | `AgentHost#dispose` 追加 `mcpRuntime.disposeAll()`；`openProject` 时 refresh 激活集合 |

## 3. 工具注册中心扩展面（关键）

`@earendil-works/pi-coding-agent` 的 `ExtensionAPI`（`dist/core/extensions/types.d.ts:906`）提供：

```ts
registerTool<TParams extends TSchema>(tool: ToolDefinition<TParams>): void;
getActiveTools(): string[];
getAllTools(): ToolInfo[];
setActiveTools(toolNames: string[]): void;
```

`ToolDefinition`（同文件 `:344`）字段：`name`、`label`、`description`、`promptSnippet?`、`promptGuidelines?`、`parameters`（TypeBox `TSchema`）、`execute(toolCallId, params, signal, onUpdate, ctx)`。

约束与对策：

1. **无 `unregisterTool`**。移除服务器后无法真正反注册。对策：连接/配置变化时整体刷新——用 `getActiveTools()` 过滤掉 `mcp_` 前缀项，再与新工具清单合并后 `setActiveTools()`；`registerTool` 对同名工具重复调用即覆盖定义。
2. **文档明确 `registerTool` 可在 `session_start` 后调用并立即生效**（`docs/extensions.md:1369`），因此可以在连接状态变化回调里动态注册。
3. 当前项目已用「普通 JSON Schema + `as never`」绕过 TypeBox 类型（`extensions/gpa.ts`），MCP 工具沿用同一写法，把 MCP `inputSchema` 直接作为 `parameters`；缺失时给 `{ type: "object", properties: {} }`。
4. `setActiveTools` 是全量覆盖：必须先取当前激活集，避免把内置 `read/bash/...` 关掉。GPA 扩展的 `tool_call` 钩子会拦截 GOAL/PLAN 阶段一切工具（包括 MCP 工具），无需额外适配。

## 4. 会话生命周期挂钩点

- `AgentHost#createFactory()`（`src/main/agent-host.ts:796`）是唯一注册 extension factory 的位置 → 在此加入 `createMcpExtension(...)`。
- `AgentHost#openProject(cwd)`（`:827`）在切换项目时重建 runtime → 在此 `mcpRuntime.setActiveProject(cwd)` 并刷新。
- `AgentHost#dispose()`（`:1904`）→ `mcpRuntime.disposeAll()`。
- 会话装配时机：`session_start` 事件里拉取 `toolsForProject()`。也可在 `before_agent_start` 每次刷新（代价是每次都要检查连接状态，runtime 内部已缓存，代价可控）。

## 5. IPC 契约草案（风格对齐现有 `app:` 域）

| 通道 | 入参 | 出参 |
|---|---|---|
| `mcp:list` | — | `{ servers: McpServerRecord[]; statuses: McpServerStatus[] }` |
| `mcp:upsert` | `McpServerInput` | `{ server: McpServerRecord }` |
| `mcp:remove` | `{ id: string }` | `{ removed: boolean }` |
| `mcp:setEnabled` | `{ id: string; enabled: boolean }` | `{ server: McpServerRecord }` |
| `mcp:test` | `{ id: string }` | `{ status: McpServerStatus }` |
| `mcp:reconnect` | `{ id: string }` | `{ status: McpServerStatus }` |
| `mcp:disconnect` | `{ id: string }` | `{ ok: boolean }` |
| `mcp:listTools` | `{ id: string }` | `{ tools: McpToolDescriptor[] }` |
| `mcp:setToolEnabled` | `{ id: string; toolName: string; enabled: boolean }` | `{ server: McpServerRecord }` |
| `mcp:import` | `{ text: string }` | `{ imported: McpServerRecord[]; failed: Array<{id,reason}> }`（增强，T13 可选） |
| `mcp:oauthStart` | `{ id: string }` | `{ ok: boolean; loginId: string }`（T13） |
| `mcp:oauthCancel` | `{ id?: string; loginId?: string }` | `{ ok: boolean }`（T13） |
| 事件 `mcp:changed` | — | `{ servers, statuses }` |

所有 handler 用现有 `wrap()`，错误统一成 `Error(message)`。

## 6. 打包与依赖

- `electron.vite.config.ts` 对 main/preload 启用 `externalizeDepsPlugin()`：本地相对导入会被打进 `out/main/index.js`；`node:child_process`、`node:fs` 为 Electron 内置，无需 externals 配置。
- **本次不新增任何 npm 依赖**（源项目自研 JSON-RPC 客户端，HTTP 用全局 `fetch`）。因此 T4 的产出是「确认无需改造 + 记录 externals 结论」，而不是改 package.json。
- `electron-builder.yml`：`files: [out/**/*, package.json]`、`asar: true`。stdio MCP 子进程用 `spawn` 执行外部命令，不受 asar 影响（子进程不在 asar 内）。

## 7. 测试基线

- `package.json#test` = `node --test "test/*.test.mjs"`，但仓库中**不存在 `test/` 目录**，且 `.gitignore` 包含 `test/`。
- `scripts/` 目录存在且未被忽略，可放置 `.mjs` 测试。
- 结论（供 T14）：MCP 纯逻辑测试放 `scripts/mcp-*.test.mjs`，并把 `test` 脚本扩展为同时运行 `scripts/mcp-*.test.mjs`；需要 Node 类型剥离时用 `import "../src/main/mcp/xxx.ts"` + `--experimental-strip-types`（Node 22.19+ 默认启用 type stripping，仍显式加 flag 更稳）。为此 `src/main/mcp/` 内的纯逻辑模块（命名空间映射、内容归一化、配置校验）**不得 import 项目内其他模块**。

## 8. 可复用资产

| 资产 | 位置 | 用途 |
|---|---|---|
| `wrap()` | `src/main/ipc.ts` | IPC 错误归一化 |
| `DialogBroker#confirm/ask` | `src/main/dialog-broker.ts` | T13 授权确认弹窗 |
| `isSecretPath` / `PermissionStore` | `src/main/permission-policy.ts`、`permission-store.ts` | T13 凭据路径保护、记忆决定 |
| `Button/Badge/Field/Switch/Modal/SectionCard/EmptyState` | `src/renderer/src/components/ui` | MCP 设置页 UI |
| `useAppStore#pushToast` | `src/renderer/src/stores/app-store.ts` | UI 反馈 |
| `PageShell/PageHeader/PageBody` | `components/ui/PageShell.tsx` | 页面骨架 |

## 9. 风险核查

| 风险 | 结论 |
|---|---|
| MCP SDK 打包兼容 | 不存在（不引入 SDK） |
| `registerTool` 动态刷新生效 | 文档保证；需在 T7 端到端验证一次 |
| `setActiveTools` 误关内置工具 | 已有明确对策（过滤前缀后合并） |
| preload 序列化深度 | 工具 schema 为浅层 JSON，无风险 |
| 子进程在打包产物中执行 | `spawn` 不受 asar 影响；需 T15 实测打包产物 |
