# T3 MCP 迁移设计决策

> 输入：`docs/mcp/migration-baseline.md`（T1）、`docs/mcp/integration-points.md`（T2）
> 结论均为单一选定方案；偏离源项目处标注「偏离」并给出理由。

## D1 传输层：直接移植源项目自研 JSON-RPC 客户端

- **选定**：把 `plugin-mcp.ts` 中的 `McpServerClient` + `createStdioTransport` + `createHttpTransport` 移植为 `src/main/mcp/client.ts`，不引入 `@modelcontextprotocol/sdk`。
- **备选**：引入官方 SDK。
- **理由**：源实现已在生产使用、只依赖 Node 内置（`child_process`、全局 `fetch`），零新增依赖即零打包风险；SDK 的 ESM/类型/打包面更复杂。
- **影响**：`package.json` 不需要新增依赖（T4 只做验证与记录）。

## D2 配置存储：`~/.pi/agent/mcp-servers.json` 单文件 + 版本号

```ts
// src/shared/mcp.ts
export type McpTransport = "stdio" | "http";
export type McpScope = { mode: "global" } | { mode: "projects"; projects: string[] };

export interface McpServerRecord {
  id: string;               // ^[a-zA-Z][a-zA-Z0-9_-]{0,63}$
  label: string;
  description?: string;
  transport: McpTransport;
  command?: string;         // stdio 必填
  args?: string[];
  env?: Record<string, string>;
  url?: string;             // http 必填，仅 http/https
  headers?: Record<string, string>;
  enabled: boolean;
  scope: McpScope;
  disabledTools?: string[]; // 工具级开关（T12）
  createdAt: string;
  updatedAt: string;
}
export interface McpFile { version: 1; servers: McpServerRecord[] }
```

- **落盘**：`getAgentDir()/mcp-servers.json`（默认 `~/.pi/agent/mcp-servers.json`，与 pi CLI 的 `models.json`、`settings.json` 同目录），`{ "version": 1, "servers": [...] }`；写入走「临时文件 + rename」原子替换；损坏时备份为 `.corrupt-<ts>.json` 并回退空配置。
- **校验上限**（对齐源项目）：服务器 ≤ 128；args ≤ 64；env ≤ 64；headers ≤ 32；单值 UTF-8 ≤ 4096 字节；env key `^[A-Za-z_][A-Za-z0-9_]*$`；header key `^[A-Za-z0-9][A-Za-z0-9-]*$`。
- **偏离**：源项目有全局 `~/.agents/servers` 与项目 `<project>/.agents/servers` 双层级文件；本次只写全局单文件，用 `scope.projects` 表达「仅在某些项目激活」。理由：当前项目没有 host-core 与 capability state，双层级会引入第二套文件扫描/迁移逻辑，收益不抵复杂度；激活语义仍保留。
- **影响文件**：`src/main/mcp/store.ts`、`src/shared/mcp.ts`。

## D3 进程边界：全部驻留主进程

- stdio 子进程、HTTP 连接、OAuth 回调均在 Electron main。渲染进程只通过 IPC 看数据。
- **理由**：renderer 无 Node 集成（`contextIsolation: true`、`nodeIntegration: false`），且工具执行必须在 main 侧（`pi` SDK 在 main 运行）。

## D4 工具命名与冲突

- **命名**：`mcp_${sanitize(serverId)}_${sanitize(toolName)}`，`sanitize = s => s.replace(/[^a-zA-Z0-9_]/g, "_")`（与源项目 `userMcpToolName` 完全一致）。
- **冲突优先级**：
  1. 内置工具（`read`/`bash`/`edit`/…）不接受覆盖——因 MCP 前缀为 `mcp_`，天然不冲突。
  2. 两服务器 sanitize 后同名（如 `a-b` 与 `a_b`）→ **先注册者胜**，后来者整台服务器的冲突工具跳过并写 warn 日志 + UI 提示。
  3. 同一服务器 `tools/list` 返回重名工具 → 保留第一个。
- **影响文件**：`src/main/mcp/namespace.ts`（纯函数，零依赖，可单测）。

## D5 工具 schema 映射

- `parameters` 直接使用 MCP `inputSchema`；非对象或缺 `type` 时回退 `{ type: "object", properties: {} }`。
- `description` 取 MCP description，缺失用 `` `${label} 的 ${toolName} 工具（MCP）` ``，截断 1024 字符。
- `promptSnippet` 固定 `mcp: tools from ${label}`，避免所有工具都挤进 prompt 的 Available tools 段。
- **理由**：源项目同样透传 `inputSchema`；SDK 的 `parameters` 类型为 TypeBox，但当前项目已有 `as never` 先例（`extensions/gpa.ts`）。

## D6 动态注册策略

- `createMcpExtension(runtime, getProjectPath)` 返回 extension factory；在 factory 内捕获 `pi` 引用（`McpToolBridge`）。
- `session_start` 时执行一次 `syncTools()`；IPC 侧任何配置/连接变化后也调用 `syncTools()`。
- `syncTools()` 算法：

```
descriptors = runtime.listToolDescriptors(projectPath)
for d of descriptors: pi.registerTool({ name: d.fullName, ... })   // 同名覆盖
next = pi.getActiveTools().filter(n => !n.startsWith("mcp_")).concat(descriptors.map(d => d.fullName))
pi.setActiveTools(next)
```

- **无 unregisterTool 的应对**：工具定义留在注册表中（不可删），但通过 `setActiveTools` 从激活集合移除；模型不会再看到它。
- **GPA 兼容**：GPA 扩展在 GOAL/PLAN 阶段按 `tool_call` 阻断全部工具，MCP 工具自动一并被阻断，无需特判。

## D7 调用结果归一化

MCP `tools/call` 返回 `{ content: [...], structuredContent?, isError? }` 映射为 SDK `AgentToolResult`：

| MCP content block | SDK 输出 |
|---|---|
| `{type:"text", text}` | `{type:"text", text}` |
| `{type:"image", data, mimeType}` | `{type:"image", data, mimeType}` |
| `{type:"resource", resource:{text}}` | `{type:"text", text}` |
| `{type:"resource", resource:{blob, mimeType}}` | 若 `image/*` 则 image，否则文本占位 `[binary resource: <uri>]` |
| 其它/未知 | 丢弃并计数 |
| `structuredContent` | 追加一个 `text` 块（`JSON.stringify`，≤ 32 KiB 截断），同时放入 `details.structuredContent` |
| 空 content | `{type:"text", text:"(MCP 工具返回空结果)"}` |

- `isError: true` → **抛出 Error**（拼接 content 文本 ≤ 500 字），与源项目 `TOOL_FAILED` 一致；SDK 会把异常呈现为工具失败。
- `details` 固定为 `{ serverId, toolName, transport, durationMs }`。
- **影响文件**：`src/main/mcp/content.ts`（纯函数，零依赖）。

## D8 安全策略

| 项 | 决策 |
|---|---|
| stdio 环境变量 | 只透传 `PATH/SYSTEMROOT/SystemRoot/windir/TEMP/TMP/TMPDIR/LANG`（大小写不敏感匹配）+ `NODE_ENV` + 用户声明值；绝不继承 `process.env` 全量 |
| stdio 命令 | 允许 PATH 名或绝对路径；拒绝含 `..` 段；`shell: false` |
| 远程 URL | 仅 `http:` / `https:`；401/403 → 状态 `failed` + `authRequired` |
| 重定向 | ≤ 5 跳；跨 origin 时丢弃自定义 headers 与 `mcp-session-id` |
| 大小限制 | stdio 单行 4 MiB、HTTP 响应体 4 MiB、`tools/list` 8 页、工具 64 个/server、活跃服务器 16 个 |
| 凭据 | `env`/`headers` 明文存 `mcp-servers.json`；UI 中 header 值默认掩码显示（`••••`），编辑时可覆盖 |
| 敏感路径 | 不涉及文件系统读写，无需 `isSecretPath` |

- **偏离**：源项目对用户服务器用 `trusted` 命令策略且同样明文存 env/headers；本次一致，但**新增**「首次启用 stdio 服务器时确认命令」的降级授权流程（见 D13）。

## D9 上下文裁剪

- 每服务器工具上限 64（超出截断并记录状态 `truncated`）。
- 活跃服务器上限 16（超出部分 `idle` 并提示）。
- 工具级开关 `disabledTools` 在注册前过滤。
- 描述截断 1024；`promptSnippet` 每个服务器一条。
- 提供「工具清单」UI 展示实际注册数量（T12）。

## D10 失败隔离与重连

- 单服务器握手失败 → 状态 `failed`，不抛出，不阻塞其它服务器与本轮对话。
- `failed` 状态在本次进程生命周期内不自动重试；仅 `mcp:test` / `mcp:reconnect` / 配置编辑后重试。
- `tools/call` **不重试**（可能已产生副作用）。
- 连接超时 10s，调用超时 100s。
- 断开时 `transport = null`、缓存工具清空；`discoveredTools` 保留作路由提示，派发前必须用新握手复核（完全沿用源项目语义）。

## D11 IPC 契约

见 `docs/mcp/integration-points.md` 第 5 节。补充决策：

- 通道统一 `mcp:` 前缀，全部 `ipcMain.handle`。
- 变更后主动 push `mcp:changed`（payload `{ servers, statuses }`），不用轮询。
- `mcp:upsert` 成功后自动执行一次 `test()`（源项目行为），失败只反映在状态里。

## D12 UI 位置与信息架构

- 放在 **设置页新增分组「MCP」**（`SettingsPage#GROUPS` 追加 `{ id: "mcp", label: "MCP", icon: PlugsConnected }`）。
- 结构：
  - 顶部：说明 + 「新增服务器」按钮 + 刷新/全部重连。
  - 列表：每行 = 状态点 + 名称 + 传输徽标（stdio/HTTP）+ 工具数 + 启用开关 + 操作（测试连接 / 重连 / 编辑 / 删除 / 查看工具）。
  - 空态：引导 + 一条示例配置。
  - 编辑：`Modal` 内的表单（不用桌面抽屉，沿用当前项目 `Modal` 组件）。
  - 工具清单：行内展开区（T12），含工具级开关。
- **理由**：当前项目没有「Agent 能力」独立页面，设置页是能力/凭据类配置的唯一归属；新增独立侧栏项会改变主导航结构（范围蔓延）。

## D13 增强项范围（明确取舍）

| 增强项 | 决策 | 说明 |
|---|---|---|
| 工具级开关（T12） | **实现** | 配置字段 `disabledTools: string[]`；注册前过滤；UI 行内展开 |
| 授权确认（T13） | **降级实现** | 新增/启用 stdio 服务器时弹 `DialogBroker#confirm`，展示将执行的完整命令；用户确认才保存并连接。远程服务器 401 时在状态行给出「请在 headers 中填写 Authorization」引导 |
| 完整 OAuth（DCR + PKCE + loopback 回调 + token 刷新） | **不实现** | 理由：源实现 874 行，依赖 `host-core` secret ref 与系统 keyring；当前项目无凭证系统，完整移植需额外引入 `safeStorage` 凭据层与回调服务器，风险与工时不匹配主链路目标。替代路径：用户在 headers 手填 `Authorization: Bearer <token>`（覆盖绝大多数远程 MCP 服务）。**在 `docs/mcp/feature-parity.md` 中显式标注为已知限制** |
| 粘贴导入（`mcp-import.ts`） | **不实现** | 与核心链路无关；避免范围蔓延。UI 不提供入口 |
| 市场 / Registry / 第三方配置扫描 | **不实现** | 源项目生态功能，超出「MCP 配置与调用逻辑」 |
| 反向 MCP 控制服务器（`mcp-control.ts`） | **不实现** | 是「把桌面暴露为 MCP server」，与本次迁移方向相反 |

## D14 与源项目的偏离清单

| # | 偏离点 | 理由 | 影响验收 |
|---|---|---|---|
| 1 | 配置文件只有全局 `mcp-servers.json`，不做项目级 `.agents/servers` 目录 | 无 host-core；用 scope 表达激活范围 | C1 仍满足（配置项含启停/scope） |
| 2 | 不实现完整 OAuth | 见 D13 | C4 中 OAuth 项标为「降级/未实现」 |
| 3 | 启动时主动连接全部已启用且全局激活的服务器（源项目懒连接） | 满足 C2「启动后状态可观测」 | C2 更强 |
| 4 | 工具注册走 SDK `registerTool` + `setActiveTools`（源项目走宿主合并） | 架构差异 | 行为等价 |
| 5 | 无粘贴导入 / 市场 / 反向控制 | 范围控制 | 不属 C1–C6 |

## D15 测试策略

- 纯逻辑模块（`namespace.ts`、`content.ts`、`store.ts` 的校验函数、`env.ts`）零项目内依赖，可被 Node 直接加载。
- 测试文件放 `scripts/mcp-*.test.mjs`，用 `node --test` 运行；导入 TS 源码时显式写 `.ts` 扩展名（Node 22.19+ type stripping）。
- `package.json#test` 扩展为：`node --test "test/*.test.mjs" "scripts/mcp-*.test.mjs"`（`test/` 不存在时先确认 Node 行为，必要时改为仅列出实际存在的 glob）。
- 集成测试（client 生命周期）用 `spawnImpl`/`fetchImpl` 注入假实现，不依赖网络。

## D16 文件影响清单

**新增（主进程）**
- `src/shared/mcp.ts` — 共享类型与常量
- `src/main/mcp/namespace.ts` — 命名映射与冲突检测（纯函数）
- `src/main/mcp/env.ts` — 环境变量白名单与命令校验（纯函数）
- `src/main/mcp/content.ts` — 结果归一化（纯函数）
- `src/main/mcp/store.ts` — 配置读写与校验
- `src/main/mcp/client.ts` — McpServerClient + 两种传输
- `src/main/mcp/runtime.ts` — McpRuntime（多服务器生命周期）
- `src/main/mcp/tools.ts` — 描述符 → SDK ToolDefinition 与同步器
- `src/main/extensions/mcp.ts` — extension factory

**修改（主进程）**
- `src/main/agent-host.ts` — 注入 MCP extension、openProject/dispose 挂钩
- `src/main/ipc.ts` — `mcp:` 通道
- `src/main/index.ts` — 启动初始化与广播
- `src/preload/index.ts`、`src/preload/index.d.ts` — API 暴露

**新增（渲染层）**
- `src/renderer/src/components/mcp/McpSettingsPanel.tsx`
- `src/renderer/src/components/mcp/McpServerDialog.tsx`
- `src/renderer/src/components/mcp/McpToolList.tsx`（T12）

**修改（渲染层）**
- `src/renderer/src/components/SettingsPage.tsx` — 新增分组

**测试与文档**
- `scripts/mcp-*.test.mjs`
- `docs/mcp/*.md`
- `package.json`（test 脚本）

## D17 实施顺序确认

T4（依赖验证）→ T5（store）→ T6（client/runtime）→ T7（namespace/tools/extension）→ T8（content + 调用链路）→ T9（IPC/preload）→ T10/T11（UI）→ T12（工具级开关）→ T13（授权确认降级）→ T14（测试）→ T15（E2E）→ T16（文档）。

> 注意：T6 与 T7 的分界为「连接与生命周期」vs「工具发现与注册」；T8 的 `content.ts` 虽是纯函数但属于调用链路，故在 T8 实现。
