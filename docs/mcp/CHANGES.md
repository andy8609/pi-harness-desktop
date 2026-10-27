# 交付文件清单与回滚

## 1. 修改文件

| 文件 | 改动 |
|---|---|
| `package.json` | `test` 指向 `test:mcp`；新增 `test:mcp`（Node type-stripping + 解析钩子运行 `scripts/mcp-*.test.mjs`）。**未新增依赖** |
| `package-lock.json` | npm 自动把版本字段从 0.1.2 同步为 0.1.0（与 `package.json` 一致）；无依赖变化 |
| `src/main/agent-host.ts` | 新增 `setMcp/getMcpRuntime`；`createFactory` 注入 MCP 扩展；`initialize` 触发 `connectAll`；`openProject` 更新项目路径并触发连接；`dispose` 关闭 MCP；顺带修复 4 处既有 TS 错误 |
| `src/main/index.ts` | 组装 `McpService`（`~/.pi/agent/mcp-servers.json`，支持 `PI_MCP_CONFIG_PATH`）；注入 host；`mcp:changed` 广播；stdio 授权确认接入；退出清理；`PI_MCP_SELFTEST` 自检入口 |
| `src/main/ipc.ts` | `registerIpc` 第三参数 `mcp?: McpService` 并注册 `mcp:` 通道；导出 `wrap`；顺带修复 3 处 `showSaveDialog/showOpenDialog` 类型错误 |
| `src/preload/index.ts` | 新增 13 个 `mcp*` 方法（含市场搜索/安装）+ `onMcpChanged` |
| `src/preload/index.d.ts` | 对应类型声明 |
| `src/renderer/src/components/SettingsPage.tsx` | 移除 MCP 分组（入口迁到侧边栏） |
| `src/renderer/src/components/Sidebar.tsx` | 资源组新增 MCP（Skills 之后） |
| `src/renderer/src/App.tsx`、`src/shared/types.ts` | `AppView` 增加 `"mcp"` 并挂载 `McpPage` |
| `src/renderer/src/components/PackageCatalog.tsx` | 已安装扩展 / Skills 的启用复选框 → 滑动开关 |
| `.gitignore` | 新增 `!docs/mcp/`，让 MCP 文档入库（其余 `docs/*` 仍忽略） |

## 2. 新增源码

| 文件 | 职责 |
|---|---|
| `src/shared/mcp.ts` | 类型、限制常量、校验、命名、scope、参数拆分 |
| `src/main/mcp/client.ts` | JSON-RPC 客户端 + stdio/HTTP 传输 + 握手/工具列表/调用；Windows 下 `.cmd`/`.bat`（`npx`/`npm` 等）经 `cmd.exe` 包装 |
| `src/main/mcp/runtime.ts` | 多服务器生命周期、失败隔离、工具缓存、调用路由 |
| `src/main/mcp/store.ts` | 配置持久化（校验、原子写、损坏备份、CRUD） |
| `src/main/mcp/tools.ts` | 工具描述符 → pi 工具定义、激活集合同步、冲突处理 |
| `src/main/mcp/content.ts` | `tools/call` 结果/错误归一化 |
| `src/main/mcp/service.ts` | 门面：store + runtime + bridge + 广播 + 授权确认 |
| `src/main/mcp/ipc.ts` | `mcp:` IPC 通道注册 |
| `src/main/mcp/selftest.ts` | 仅测试用的启动自检（`PI_MCP_SELFTEST`） |
| `src/main/extensions/mcp.ts` | 把工具桥挂到 pi 扩展运行时 |
| `src/renderer/src/components/mcp/McpSettingsPanel.tsx` | 设置页 MCP 分区 |
| `src/renderer/src/components/mcp/McpServerDialog.tsx` | 新增/编辑表单 |
| `src/renderer/src/components/mcp/McpToolList.tsx` | 工具清单与工具级开关 |
| `src/renderer/src/components/mcp/McpPage.tsx` | MCP 独立页面（已安装 / 市场） |
| `src/renderer/src/components/mcp/McpMarketPanel.tsx` | 市场列表：搜索、分类、加载更多、安装入口 |
| `src/renderer/src/components/mcp/McpCatalogInstallDialog.tsx` | 市场安装表单与命令预览 |
| `src/shared/mcp-catalog.ts` | 市场模板类型、校验、占位符渲染、搜索匹配 |
| `src/shared/mcp-catalog-builtin.ts` | 内置 15 条精选模板 |
| `src/shared/mcp-registry.ts` | 官方 Registry 记录 → 模板映射 |
| `src/main/mcp/registry-client.ts` | Registry 网络客户端（超时/上限/分页） |
| `src/main/mcp/market.ts` | 内置 + Registry 合并搜索与安装 |

## 3. 新增测试与脚本

| 文件 | 用途 |
|---|---|
| `scripts/mock-mcp-server.mjs` | 零依赖 stdio MCP 服务器（echo/add/fail/slow/big） |
| `scripts/mcp-store.test.mjs` | 配置层（8 用例） |
| `scripts/mcp-runtime.test.mjs` | 连接生命周期（9 用例） |
| `scripts/mcp-tools.test.mjs` | 工具注册/冲突（5 用例） |
| `scripts/mcp-content.test.mjs` | 结果/错误归一化（5 用例） |
| `scripts/mcp-client.test.mjs` | HTTP/SSE/超时/崩溃（7 用例） |
| `scripts/mcp-service.test.mjs` | 服务联动 + 授权确认（7 用例） |
| `scripts/mcp-extension.test.mjs` | 真实 pi 会话工具注入（1 用例） |
| `scripts/mcp-catalog.test.mjs` | 模板引擎与内置目录（7 用例） |
| `scripts/mcp-registry.test.mjs` | Registry 映射（6 用例） |
| `scripts/mcp-market.test.mjs` | 网络客户端与市场合并/安装（6 用例） |
| `scripts/ts-resolve-hooks.mjs` / `ts-resolve-register.mjs` | Node 测试加载 TS 源码的解析钩子 |
| `scripts/mcp-env-probe.mjs` | 运行时能力探针（spawn + fetch） |
| `scripts/e2e-mcp-electron.mjs` | Electron 端到端（支持 `PI_E2E_BINARY` 跑打包产物） |

## 4. 新增文档

`docs/mcp/`：`README.md`、`market.md`、`market-baseline.md`、`market-design.md`、`migration-baseline.md`、`integration-points.md`、`design-decisions.md`、`build-notes.md`、`ui-inventory.md`、`ipc-contract.md`、`auth.md`、`testing.md`、`e2e-report.md`、`feature-parity.md`、`CHANGES.md`。

## 5. 运行时数据

| 路径 | 说明 |
|---|---|
| `~/.pi/agent/mcp-servers.json` | MCP 配置；删除后即恢复「无 MCP 服务器」状态 |
| `~/.pi/agent/mcp-servers.json.corrupt-*.json` | 配置损坏时的自动备份 |

## 6. 回滚步骤

```bash
# 1) 还原修改过的文件
git checkout -- package.json package-lock.json .gitignore \
  src/main/agent-host.ts src/main/index.ts src/main/ipc.ts \
  src/preload/index.ts src/preload/index.d.ts \
  src/renderer/src/components/SettingsPage.tsx

# 2) 删除新增源码
rm -rf src/main/mcp src/shared/mcp.ts src/shared/mcp-catalog.ts src/shared/mcp-catalog-builtin.ts       src/shared/mcp-registry.ts src/main/extensions/mcp.ts src/renderer/src/components/mcp

# 3) 删除测试与脚本
rm -f scripts/mock-mcp-server.mjs scripts/mcp-env-probe.mjs scripts/e2e-mcp-electron.mjs \
      scripts/ts-resolve-hooks.mjs scripts/ts-resolve-register.mjs scripts/mcp-*.test.mjs

# 4) 删除文档
rm -rf docs/mcp

# 5) 重新构建验证
npm run build
```

> 回滚后侧边栏不再有 MCP 项，设置页也不会恢复 MCP 分组（两处改动在同一提交内）。

运行时残留（可选）：删除 `~/.pi/agent/mcp-servers.json`。回滚后应用不再读取它。

## 7. 验收对照

| 标准 | 证据 |
|---|---|
| C1 配置层（字段/持久化/热生效） | `docs/mcp/README.md#2`、`scripts/mcp-store.test.mjs` |
| C2 连接层（自动连接/状态/重连） | `docs/mcp/e2e-report.md#2`、`scripts/mcp-runtime.test.mjs` |
| C3 调用层（tools/list 注册 + tools/call 成功 + 失败隔离） | `docs/mcp/e2e-report.md#2.1/2.3`、`scripts/mcp-extension.test.mjs` |
| C4 增强项 | 工具级开关 ✅（`McpToolList.tsx`）；OAuth ⚠️ 降级（`docs/mcp/auth.md`） |
| C5 工程健康 | `tsc` 双配置 0 错误、`npm run build` 通过、`npm test` 42/42 |
| C6 端到端实测 | `docs/mcp/e2e-report.md`（stdio + HTTP + 打包产物） |
