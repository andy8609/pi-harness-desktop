# T14 MCP 测试清单与运行方式

## 1. 运行

```bash
npm test          # 等价于 npm run test:mcp
npm run test:mcp  # 全部 MCP 测试（44 个用例）
```

机制：Node 22 的 TypeScript 类型剥离 + `scripts/ts-resolve-hooks.mjs`（把 `@shared/*` 与无扩展名相对导入解析到 `.ts`），因此测试直接加载源码，不需要先构建。

## 2. 文件与覆盖点

| 文件 | 用例数 | 覆盖内容 |
|---|---|---|
| `scripts/mcp-store.test.mjs` | 8 | 配置读写往返、非法字段拒绝（id/command/`..`/env key/args 上限/url 协议）、重复 id、启停、工具级开关、删除、损坏文件备份、加载时跳过非法/重复项、scope 与命名空间映射 |
| `scripts/mcp-runtime.test.mjs` | 9 | 多服务器失败隔离、failed 不自动重试、配置变化断开（label 变化不重连）、命名空间路由、未知/禁用工具、scope 项目过滤、真实 stdio 握手与调用、`disposeAll` 无残留子进程、连接超时、命令校验 |
| `scripts/mcp-tools.test.mjs` | 5 | 工具注册与内置工具保留、移除服务器后从激活集合消失、工具级开关过滤、sanitize 撞名冲突、参数 schema 边界 |
| `scripts/mcp-content.test.mjs` | 5 | 文本/结构化结果、图片与资源块、未知块丢弃、空结果、超长截断、错误文案归一化（超时/不可用/工具失败/401/未知） |
| `scripts/mcp-client.test.mjs` | 9 | HTTP JSON、HTTP SSE、401、重定向上限与 header 保留、`tools/list` 分页与 64 上限、连接超时、stdio 子进程崩溃、Windows `.cmd`（npx）包装、含空格的绝对 `.cmd` 路径启动 |
| `scripts/mcp-service.test.mjs` | 7 | 配置变更 → 运行时 → 工具注册联动、禁用后工具移除、工具级开关持久化、删除清理连接、stdio 授权拒绝回滚、授权通过与命令变化重新确认、损坏配置启动 |
| `scripts/mcp-extension.test.mjs` | 1 | **真实 pi 扩展运行时**：会话 `getAllTools()` 含 MCP 工具、`getActiveToolNames()` 含 MCP 工具、移除服务器后从激活集合消失（定义保留） |

合计 **44** 个用例，全部不依赖真实网络与外部 MCP 服务器（使用 `scripts/mock-mcp-server.mjs` 与本地 loopback HTTP）。

## 3. 关键回归点

- `McpToolBridge` 在扩展加载阶段调用 `setActiveTools` 会抛 `Extension runtime not initialized`。实现用 try/catch 记录 `activeSynced=false`，并在 `session_start` 后重试；`mcp-extension.test.mjs` 锁定该行为。
- 配置变更只关闭连接，不重试 `tools/call`。
- `failed` 状态在进程生命周期内不自动重试，仅 `test` / `reconnect` / 编辑配置触发。

## 4. 未自动化的部分

| 项 | 原因 | 手工/替代验证 |
|---|---|---|
| GUI 点击流（设置页增删改） | 无 UI 自动化框架 | `scripts/e2e-mcp-electron.mjs` 覆盖主进程全链路；UI 交互需人工按 `docs/mcp/e2e-report.md` 步骤操作 |
| 真实第三方 MCP 服务器 | 依赖网络与 npm 包 | 使用等价 mock server；`docs/mcp/e2e-report.md` 记录可复现步骤 |
| 完整 OAuth | 未实现（D13） | 见 `docs/mcp/auth.md` |
