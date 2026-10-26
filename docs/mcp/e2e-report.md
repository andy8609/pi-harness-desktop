# T15 端到端实测与回归报告

## 1. 环境

| 项 | 值 |
|---|---|
| OS | Windows 10 Pro 19045（x64） |
| Node（构建/测试） | v22.23.2 |
| Electron | 37.3.1（内置 Node 22.18.0） |
| electron-vite | 4.0.0 |
| 打包工具 | electron-builder 26.0.12（`--dir`，win x64） |
| 测试 MCP 服务器 | `scripts/mock-mcp-server.mjs`（stdio，5 工具）+ 脚本内置 loopback HTTP MCP（SSE，2 工具） |

## 2. 自动化实测结果

### 2.1 主进程全链路（开发产物）

```
$ node scripts/e2e-mcp-electron.mjs
端到端实测通过
{
  "electron": "37.3.1",
  "node": "22.18.0",
  "toolCount": 7,
  "toolNames": [
    "mcp_mock_stdio_echo", "mcp_mock_stdio_add", "mcp_mock_stdio_fail",
    "mcp_mock_stdio_slow", "mcp_mock_stdio_big",
    "mcp_mock_http_echo", "mcp_mock_http_fail"
  ],
  "statuses": [
    { "serverId": "mock-stdio", "state": "ready", "toolCount": 5 },
    { "serverId": "mock-http",  "state": "ready", "toolCount": 2 }
  ],
  "echo": "selftest",
  "failToolRejected": true
}
```

覆盖：外部配置文件读取 → stdio 子进程握手 → HTTP(SSE) 握手 → `tools/list` → `tools/call` → `isError` 判定失败。

### 2.2 打包产物全链路（asar）

```
$ PI_E2E_BINARY="release/win-unpacked/Pi Desktop.exe" node scripts/e2e-mcp-electron.mjs
端到端实测通过   # 结果与 2.1 完全一致
```

证明：asar 打包后 main 进程可正常 `spawn` 外部 stdio 服务器、可发起 HTTP 请求、工具命名空间与状态上报均正确。

### 2.3 真实 pi 扩展运行时（工具真正进入会话）

`scripts/mcp-extension.test.mjs`：

- `session.getAllTools()` 含 `mcp_mock_*` 5 个工具；
- `session.getActiveToolNames()` 含同 5 个工具；
- 移除服务器并 `bridge.sync()` 后，激活集合不再包含它们，但 `getToolDefinition` 仍可查到（符合 pi 无 `unregisterTool` 的设计）。

### 2.4 真实第三方服务器：Context7

```
配置：{ id: "context7", command: "npx", args: ["-y", "@upstash/context7-mcp"] }
状态：ready，发现 2 个工具（resolve-library-id、query-docs）
调用：resolve-library-id({ libraryName: "react", query: "how to use hooks" })
结果：返回 /reactjs/react.dev、/react/react 等库 ID（真实网络请求）
```

同时修复了 Windows 下 `spawn("npx")` 的 `ENOENT`：`.cmd` / `.bat` 现在通过 `cmd.exe /d /s /c` 包装执行，`.exe` 与其它平台仍直接 spawn。

### 2.5 打包产物启动冒烟

```
$ start "release/win-unpacked/Pi Desktop.exe" → 8 秒后仍存活（alive=True）
```

stderr 仅有 Chromium 的 GPU/disk cache 权限告警（复用 userData 目录导致，与 MCP 无关），无 renderer 崩溃、无未捕获异常。

## 3. 全量回归

| 检查 | 命令 | 结果 |
|---|---|---|
| 主进程类型检查 | `npx tsc -p tsconfig.node.json --noEmit` | ✅ 0 错误（含修复的 6 处既有错误） |
| 渲染层类型检查 | `npx tsc -p tsconfig.web.json --noEmit` | ✅ 0 错误 |
| 构建 | `npm run build` | ✅ main 175 kB / preload 6.5 kB / renderer 1.41 MB |
| 单元 + 集成测试 | `npm test` | ✅ 42/42 通过 |
| 开发产物 E2E | `node scripts/e2e-mcp-electron.mjs` | ✅ |
| 打包产物 E2E | `PI_E2E_BINARY=... node scripts/e2e-mcp-electron.mjs` | ✅ |
| 打包产物启动 | 启动 8 秒存活 | ✅ |

## 4. 失败项与处理

| 项 | 现象 | 处理 |
|---|---|---|
| 扩展加载阶段设置激活集合 | `Extension runtime not initialized`，inline 扩展整体加载失败，MCP 工具不进会话 | 在 `McpToolBridge.sync()` 中捕获并标记 `activeSynced=false`，`session_start` 后重试；`mcp-extension.test.mjs` 锁定 |
| 既有 6 处 TS 错误 | `tsc -p tsconfig.node.json` 失败 | 修复：`ThinkingLevel[]` 显式标注、`AuthPrompt.options` 改 readonly、`prompt.options ?? []`、`getSessionInfo` 展开对象、`showSaveDialog/showOpenDialog` 不传窗口 |

无遗留失败项。

## 5. 未自动化 / 需人工确认

UI 点击流（设置页增删改、工具开关）尚无自动化框架覆盖。手工验收步骤：

1. `npm run dev` 启动应用 → 打开「设置」→ 左侧「MCP」。
2. 点「新增服务器」：
   - ID `mock`、名称 `Mock`、传输 `stdio`、命令填 Node 绝对路径或 `node`、参数填 `scripts/mock-mcp-server.mjs`。
   - 保存 → 应弹出「确认执行本机命令」→ 确认。
   - 行内状态应从「连接中」变为「已连接」，工具数为 5。
3. 点「工具」展开清单 → 关闭 `echo` → 清单显示「已禁用 1 个」；重启应用后该开关仍保持。
4. 点「测试」→ 应提示「连接成功，发现 N 个工具」。
5. 新增 HTTP 服务器（如 `https://mcp.example.com/mcp`，headers 填 `Authorization`）→ 保存 → 状态应为已连接或给出明确的 401 引导。
6. 编辑服务器：仅改显示名称保存 → 不应重连（状态保持「已连接」）；改命令/URL → 应重连。
7. 删除服务器 → 二次点击确认 → 从列表消失；返回对话后模型工具列表不再包含 `mcp_<id>_*`。
8. 在对话里要求模型调用 `mcp_mock_echo`（需先打开项目并配置模型）→ 应返回回显文本；调用 `mcp_mock_fail` → 应显示工具失败。
9. 关闭应用 → 任务管理器中无残留 `node`/mock 服务器进程。

## 6. 已知限制

- 完整 OAuth 未实现（见 `docs/mcp/auth.md`），远程服务器需手动填 `Authorization` header。
- 配置文件为明文 JSON，`env`/`headers` 中的凭据不做加密存储（与源项目一致）。
- 配置文件只有全局一份（`~/.pi/agent/mcp-servers.json`），不支持源项目的项目级 `.agents/servers` 目录。
