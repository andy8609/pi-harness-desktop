# T1 源项目 MCP 市场实现盘点

> 只读检查 `D:\test\PI-Desktop-main`，未改动源项目。
> 目标：为当前项目复刻「内置精选 + 官方 Registry 在线搜索」的市场能力提供事实基线。

## 1. 架构分层

```
渲染层 McpMarketPanel.tsx
  ├─ 内置目录：直接 import BUILTIN_MCP_CATALOG（离线可用）
  ├─ 远程搜索：api.searchMcpMarketRegistry(query, sources, { more })
  ├─ 分类/分页/搜索（本地过滤内置 + 远程结果）
  └─ 安装：resolveCatalogEntry(entry, values) → api.upsertMcpServer(input)
        │
主进程 mcp-registry-catalog.ts
  ├─ 多来源聚合（MarketSource: registry | catalog）
  ├─ Registry 分页游标（PAGE_SIZE=100，首屏 2 页，load more 10 页）
  ├─ 5 分钟缓存、8s 超时、4 MiB 上限、5 跳重定向
  ├─ 公网地址策略（DNS 解析 + 私网/回环拒绝）
  └─ 失败来源记入 failedSources，整体降级到内置目录
        │
共享层 packages/shared
  ├─ mcp-catalog.ts      模板类型 / 校验 / 占位符渲染
  ├─ mcp-catalog-builtin 内置 15 条
  ├─ mcp-registry.ts     Registry 记录 → 模板映射
  └─ public-network.ts   https / 公网地址判定
```

## 2. 文件清单与职责

| 路径 | 行数 | 职责 |
|---|---|---|
| `packages/shared/src/mcp-catalog.ts` | 260 | `McpCatalogEntry`、`McpCatalogRequiredEnv`、`catalogEntryError`、`resolveCatalogEntry`、`collectCatalogPlaceholders`、`validateMcpCatalogFile` |
| `packages/shared/src/mcp-catalog-builtin.ts` | 226 | 内置 15 条模板（stdio 9 / http 6） |
| `packages/shared/src/mcp-registry.ts` | 349 | `RegistryRecord` 类型、`registryIdFromName`、`argumentValues`、`guessCategory`、`mapRegistryServer`、`mergeRegistryEntries`、`MarketSource` / `sanitizeMarketSources` |
| `packages/shared/src/public-network.ts` | 441 | `isPublicHttpsUrl`、IP/域名公网判定、DNS 解析策略（主进程用于防 SSRF） |
| `apps/desktop/electron/main/mcp-registry-catalog.ts` | 470 | 多来源搜索聚合、分页游标、缓存、超时、失败降级 |
| `apps/desktop/src/components/settings/McpMarketPanel.tsx` | 740 | 搜索/分类/分页/安装表单/来源管理 |
| `apps/desktop/electron/main/ipc/mcp-ipc.ts` | — | `mcpMarketSearch` 通道 |

## 3. Registry API 契约

| 项 | 值 |
|---|---|
| Base URL | `https://registry.modelcontextprotocol.io/v0/servers` |
| 方法 | `GET` |
| Query | `version=latest`、`limit=100`、`search=<关键词>`（可选）、`cursor=<nextCursor>`（可选） |
| 响应 | `{ servers: RegistryRecord[], metadata?: { nextCursor?: string } }` |
| 分页 | `metadata.nextCursor` 存在且不等于上一游标时继续；否则 `exhausted=true` |
| 缓存 | 5 分钟；浏览器式 LRU（最多 128 键 / 2000 条） |
| 限制 | 超时 8s、响应 4 MiB、重定向 5 跳、query 截断 200 字符、页码 100 |
| 失败 | 单来源失败只记 `failedSources`，不抛错；全部失败时返回内置目录 |

### Registry 记录字段（用到的部分）

```ts
type RegistryRecord = {
  server?: {
    name?: string;            // 反向域名，如 "com.pulsemcp/foo"
    title?: string;
    description?: string;
    homepage?: string;
    repository?: { url?: string } | string;
    packages?: Array<{
      registryType?: "npm" | "pypi" | "oci" | string;
      identifier?: string;
      version?: string;
      runtimeHint?: string;   // 如 npx / uvx
      runtimeArguments?: Array<{ type?: "named" | "positional"; name?: string; value?: string }>;
      packageArguments?: Array<{ type?: string; name?: string; value?: string }>;
      environmentVariables?: Array<{ name?: string; description?: string; isRequired?: boolean; value?: string; default?: string }>;
    }>;
    remotes?: Array<{
      type?: "streamable-http" | string;
      url?: string;
      headers?: Array<{ name?: string; value?: string }>;
    }>;
  };
};
```

## 4. 映射规则（`mapRegistryServer`）

1. `server.name` 缺失 → `null`（不展示）。
2. id：`registryIdFromName(name)`，小写、非字母数字转 `-`、长度 ≤64、以字母开头。
3. 优先级：**npm > pypi > streamable-http**；`oci` 等无运行方式的记录直接丢弃。
4. npm：`command = runtimeHint ?? "npx"`，args = runtimeArguments + `identifier@version` + packageArguments。
5. pypi：`command = runtimeHint ?? "uvx"`，args 同上，附 `prerequisites: ["Requires uv/uvx on PATH"]`。
6. remote：仅 `type === "streamable-http"` 且 `isPublicHttpsUrl(url)`；headers 中的 `${NAME}` 自动生成 `requiredEnv`。
7. 环境变量：`environmentVariables` → `env: { NAME: "${NAME}" }` + `requiredEnv`（`isRequired=false` → `optional: true`，`value/default` → `defaultValue`）。
8. 分类：关键词猜测（data/productivity/web/devtools/docs），兜底 `devtools`。
9. 映射结果必须通过 `catalogEntryError`，否则丢弃。

## 5. 模板格式与渲染

```ts
type McpCatalogEntry = {
  id: string; name: string; description?: string; author?: string; homepage?: string;
  categories?: ("devtools"|"web"|"docs"|"data"|"productivity")[];
  verified?: boolean;
  transport: "stdio" | "http";
  command?: string; args?: string[]; env?: Record<string,string>;
  url?: string; headers?: Record<string,string>;
  requiredEnv?: { name: string; description?: string; optional?: boolean; defaultValue?: string }[];
  prerequisites?: string[];
  notes?: string;
};
```

- 占位符语法：`${NAME}`，`NAME` 必须匹配 `^[A-Z_][A-Z0-9_]*$`，且必须在 `requiredEnv` 中声明。
- `resolveCatalogEntry(entry, values)`：
  - 取值优先级：表单值 > `defaultValue` > 空。
  - 非 optional 且为空 → 抛错 `"<name>: missing value for <NAME>"`。
  - optional 且为空 → **整条 env/header 被丢弃**（不会把字面量 `${...}` 传给进程）。
  - stdio：填充 `command`/`args`/`env`；http：填充 `url`/`headers`。
- `catalogEntryError` 额外规则：stdio 必须有 command 且不含 `..`；http 必须是 `https:` 且为公网地址。

## 6. 内置目录（15 条）

| id | 传输 | 命令/URL | 分类 | 需填值 |
|---|---|---|---|---|
| memory | stdio | `npx -y @modelcontextprotocol/server-memory` | productivity | — |
| sequential-thinking | stdio | `npx -y @modelcontextprotocol/server-sequential-thinking` | productivity | — |
| everything | stdio | `npx -y @modelcontextprotocol/server-everything` | docs | — |
| filesystem | stdio | `npx -y @modelcontextprotocol/server-filesystem ${MCP_FS_ROOT}` | data | `MCP_FS_ROOT`（默认 `.`） |
| playwright | stdio | `npx -y @playwright/mcp@latest` | web | — |
| context7 | stdio | `npx -y @upstash/context7-mcp` | docs | — |
| fetch | stdio | `uvx mcp-server-fetch` | web | — |
| git | stdio | `uvx mcp-server-git` | devtools | — |
| time | stdio | `uvx mcp-server-time` | productivity | — |
| serena | stdio | `uvx --from git+https://github.com/oraios/serena serena start-mcp-server --context ide-assistant` | devtools | — |
| deepwiki | http | `https://mcp.deepwiki.com/mcp` | docs | — |
| notion | http | `https://mcp.notion.com/mcp` | productivity | — |
| exa | http | `https://mcp.exa.ai/mcp` | web | — |
| github | http | `https://api.githubcopilot.com/mcp/` | devtools | `GITHUB_PAT`（Authorization header） |
| brave-search | stdio | `npx -y @modelcontextprotocol/server-brave-search` | web | `BRAVE_API_KEY` |

## 7. 渲染层交互

| 项 | 行为 |
|---|---|
| 搜索 | 350 ms 防抖；内置目录本地过滤 + 远程搜索（服务端过滤） |
| 分类 | `all` + 5 类；内置与远程统一过滤 |
| 分页 | 每页 24 条；「加载更多」追加远程下一页（每批 10 页） |
| 安装 | 点击卡片 → 安装面板：按 `requiredEnv` 渲染输入框（默认值预填）→ 展示最终命令 → 保存 |
| 已安装 | `installedIds` 传入，卡片显示已安装态 |
| 来源管理 | 用户可增删 registry/catalog 来源（localStorage 持久化） |
| 错误 | 远程失败显示 `failedSources`，内置目录仍可安装 |

## 8. 安装流程时序

```
用户点击市场卡片
  → openInstall：用 requiredEnv.defaultValue 预填表单
  → 用户填写 → resolveCatalogEntry(entry, values)（缺值即抛错，前端展示）
  → api.upsertMcpServer(input)（与手工新增同一条 upsert 路径）
  → 主进程校验、写入、触发连接测试
  → 渲染层收到 pluginChanged → 刷新已安装列表
```

## 9. 本次迁移的取舍建议

| 源能力 | 本次 | 理由 |
|---|---|---|
| 内置目录 | 全量移植 15 条 | 离线可用，成本低 |
| 官方 Registry 搜索 | 移植（固定官方源） | 用户明确要求等价 |
| 多来源管理（自定义 registry/catalog URL） | **不做** | 范围控制；固定官方源已满足需求 |
| 分页「加载更多」 | 做（简单游标） | Registry 单页 100 条，需要翻页 |
| 分类关键词猜测 | 移植 | 成本低、体验提升明显 |
| 安装表单 | 做（requiredEnv → 输入框） | 市场可用性的核心 |
| i18n 文案 | 不做 | 当前项目统一中文 |
| 公网地址策略（DNS/私网拒绝） | **简化**：仅 https + 主机名黑名单（localhost/私网 IP 字面量） | 当前项目无 `public-network` 基础设施；Registry 返回的地址由官方索引提供 |
| 第三方客户端配置扫描 | 不做 | 目标已排除 |
