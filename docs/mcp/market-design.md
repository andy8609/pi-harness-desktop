# T3 市场与页面改造设计决策

> 输入：`docs/mcp/market-baseline.md`（T1）、`docs/mcp/ui-inventory.md`（T2）
> 结论均单一选定；偏离源项目处标注理由。

## D1 市场数据源：内置 15 条 + 官方 Registry 固定源

- **选定**：内置目录始终可用；官方 Registry 固定为 `https://registry.modelcontextprotocol.io/v0/servers`，不做用户自定义来源管理。
- **备选**：移植源项目的多来源（registry/catalog + localStorage）。
- **理由**：用户要求「市场迁移」的核心是浏览与安装；多来源管理是低频配置，会引入 URL 存储、来源增删 UI、安全校验三块成本。
- **影响**：`src/shared/mcp-catalog-builtin.ts`、`src/main/mcp/registry-client.ts`。

## D2 内置目录：完整移植 15 条

- 保留源项目全部条目（stdio 10 / http 5），文案改为与当前项目一致的中文，去掉 i18n 依赖。
- 条目 id 与已安装的 `context7` 保持一致（安装表单可识别「已安装」）。
- 每条必须通过 `catalogEntryError`（测试逐条断言）。

## D3 模板引擎：移植并去掉 `public-network` 依赖

- 文件：`src/shared/mcp-catalog.ts`。
- 保留：`McpCatalogEntry`、`requiredEnv`、`${NAME}` 占位符、`catalogEntryError`、`resolveCatalogEntry`、`collectCatalogPlaceholders`、`validateMcpCatalogFile`。
- 简化：http 模板校验用 `isSafeHttpsUrl()`（仅 https + 拒绝 localhost/私网 IP 字面量），不移植 441 行 DNS 解析策略。
- 占位符规则不变：未知占位符拒绝；optional 且空值丢弃整条 env/header。
- **理由**：模板引擎是纯函数、可直接单测；DNS/SSRF 策略属于主进程网络层，本次 Registry 只请求固定官方域名，风险面小。

## D4 Registry 映射：移植 `mapRegistryServer`

- 文件：`src/shared/mcp-registry.ts`。
- 保留：npm > pypi > streamable-http 优先级、`oci` 丢弃、`registryIdFromName`、`argumentValues`、`guessCategory`、`mergeRegistryEntries`。
- 简化：remote 校验用 `isSafeHttpsUrl`；不移植 `MarketSource`/`sanitizeMarketSources`。
- 映射结果必须过 `catalogEntryError`，否则丢弃。

## D5 网络客户端：`src/main/mcp/registry-client.ts`

| 项 | 决策 |
|---|---|
| HTTP | 全局 `fetch`（Electron main 已具备） |
| 固定端点 | 常量 `REGISTRY_ENDPOINT`，不接受外部覆盖 |
| 参数 | `version=latest`、`limit=100`、`search`（≤200 字符）、`cursor` |
| 超时 | 8 s（`AbortController`） |
| 响应上限 | 4 MiB（复用 client.ts 的 `readBoundedHttpBody` 思路，独立实现小函数） |
| 重定向 | 不跟随（`redirect: "manual"`，遇 3xx 报错）——固定端点正常不会重定向 |
| 缓存 | **不做服务端缓存**；渲染层用防抖 + 显式「加载更多」，避免缓存失效与游标错乱 |
| 错误 | 归一化为 `{ ok: false, message }`，文案区分超时/网络/状态码/解析失败 |

## D6 IPC 契约

| 通道 | 入参 | 出参 |
|---|---|---|
| `mcp:marketSearch` | `{ query?: string; cursor?: string; more?: boolean }` | `{ entries: McpMarketEntry[]; nextCursor?: string; remoteError?: string }` |
| `mcp:marketInstall` | `{ entry: McpCatalogEntry; values: Record<string,string> }` | `{ server: McpServerRecord; cancelled?: boolean }` |

- `McpMarketEntry = McpCatalogEntry & { source: "builtin" | "official" }`。
- `more=false`：返回匹配 query 的内置条目 + Registry 第一页；`more=true`：只返回 Registry 下一页（内置不重复）。
- `remoteError` 存在时 UI 显示错误条，内置结果照常可用。
- 安装：主进程用 `catalogEntryError` 重新校验 entry → `resolveCatalogEntry(entry, values)` → `McpService.upsert`。不新增写路径。

## D7 MCP 页面与 IA

- `AppView` 增加 `"mcp"`；侧边栏「资源」组顺序：扩展 → Skills → **MCP** → 模型。
- `McpPage`：`PageShell` + `PageHeader`（标题「MCP」+ 描述 + 右侧「新增服务器」/「重新读取」）+ `SegmentedControl` Tab：
  - **已安装**：现有 `McpSettingsPanel` 改造成列表组件（去掉 `SectionCard`）。
  - **市场**：`McpMarketPanel`。
- 设置页移除 MCP 分组，保证单一入口。

## D8 安装表单

- `McpCatalogInstallDialog`：读取 `entry.requiredEnv` 渲染输入（`defaultValue` 预填），展示最终命令/URL 预览，保存调用 `mcp:marketInstall`。
- 缺必填值：前端先校验并阻止提交；后端二次校验。
- 安装成功：toast + 切回「已安装」Tab 并在列表中高亮该 id。
- 安装取消（stdio 授权拒绝）：`cancelled=true` → toast 警告，不显示为已安装。

## D9 列表开关统一

- 仅修改 `PackageCatalog.tsx` 的 `InstalledResourceList`：`checkbox + label` → `Switch` + 文本。
- 保留 `ModelSelectionPanes` 的 4 处表单复选框（多选/能力勾选），T2 清单为准。
- 开关行为：`disabled={busy}`、`aria-label` 含资源名、失败以服务端返回的 inventory 刷新。

## D10 安全

- Registry 端点固定为官方 https；不渲染层传入地址。
- 模板 http 地址必须 https 且非 localhost/私网字面量。
- 安装前主进程重新校验模板，不信任渲染层。
- Registry 响应只取已知字段，未知字段忽略；条目无运行方式则丢弃。

## D11 测试策略

| 层 | 方式 |
|---|---|
| 模板引擎 / 内置目录 / Registry 映射 | 纯函数单测（`scripts/mcp-catalog.test.mjs`） |
| 网络客户端 | 注入假 `fetch`（`scripts/mcp-market.test.mjs`），覆盖成功/非 2xx/超时/超大/坏 JSON |
| 合并与安装 | 假 `McpService` + 假 fetch，验证内置优先、去重、remoteError、安装取消 |
| UI | 不引入组件测试框架；由 T12 的 E2E + 手工清单覆盖 |

## D12 文件影响清单

**新增**
- `src/shared/mcp-catalog.ts`
- `src/shared/mcp-catalog-builtin.ts`
- `src/shared/mcp-registry.ts`
- `src/main/mcp/registry-client.ts`
- `src/main/mcp/market.ts`
- `src/renderer/src/components/mcp/McpPage.tsx`
- `src/renderer/src/components/mcp/McpMarketPanel.tsx`
- `src/renderer/src/components/mcp/McpCatalogInstallDialog.tsx`
- `scripts/mcp-catalog.test.mjs`、`scripts/mcp-market.test.mjs`

**修改**
- `src/main/mcp/ipc.ts`（market 通道）
- `src/main/ipc.ts`（透传 market 依赖，如需）
- `src/preload/index.ts`、`index.d.ts`
- `src/shared/types.ts`（`AppView`）
- `src/renderer/src/components/Sidebar.tsx`
- `src/renderer/src/App.tsx`
- `src/renderer/src/components/mcp/McpSettingsPanel.tsx`（页面化）
- `src/renderer/src/components/SettingsPage.tsx`（移除分组）
- `src/renderer/src/components/PackageCatalog.tsx`（开关）

**文档**：`docs/mcp/market.md`、README/USAGE/feature-parity/CHANGES/testing/e2e-report。

## D13 与源项目的偏离

| # | 偏离 | 理由 |
|---|---|---|
| 1 | 不做自定义市场来源 | 范围控制，固定官方源 |
| 2 | 不做服务端搜索缓存 | 避免游标错乱；UI 防抖足够 |
| 3 | 不移植 DNS/私网解析策略 | 仅访问固定官方域名；模板地址仍强制 https |
| 4 | 安装 IPC 由渲染层传模板，主进程二次校验 | 省去后端缓存 entry；校验等价于手工配置 |
| 5 | 无 i18n | 当前项目统一中文 |
| 6 | 市场未做分页器（页码跳转），仅「加载更多」 | Registry 条目多，页码无意义；内置目录一次展示 |
