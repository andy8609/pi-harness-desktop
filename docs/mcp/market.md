# MCP 市场使用说明

MCP 页面（侧边栏「资源 → MCP」）分两个 Tab：**已安装** 与 **市场**。

## 1. 市场能做什么

- **内置精选目录**：15 个常见服务器模板，断网也能浏览与安装。
- **官方 Registry 在线搜索**：实时搜索 `registry.modelcontextprotocol.io`，可「加载更多」翻页。
- **按分类筛选**：开发工具 / 网页 / 文档 / 数据 / 效率。
- **安装表单**：按模板声明的必填值（API Key、文件根目录等）填表，预览最终命令后一键安装。

## 2. 内置目录（15 条）

| 名称 | 传输 | 一键配置 | 需要填写 |
|---|---|---|---|
| Memory | stdio | `npx -y @modelcontextprotocol/server-memory` | — |
| Sequential Thinking | stdio | `npx -y @modelcontextprotocol/server-sequential-thinking` | — |
| Everything | stdio | `npx -y @modelcontextprotocol/server-everything` | — |
| Filesystem | stdio | `npx -y @modelcontextprotocol/server-filesystem ${MCP_FS_ROOT}` | 根目录（默认 `.`） |
| Playwright | stdio | `npx -y @playwright/mcp@latest` | — |
| Context7 | stdio | `npx -y @upstash/context7-mcp` | — |
| Fetch | stdio | `uvx mcp-server-fetch` | 需本机装有 uv |
| Git | stdio | `uvx mcp-server-git` | 需本机装有 uv |
| Time | stdio | `uvx mcp-server-time` | 需本机装有 uv |
| Serena | stdio | `uvx --from git+https://github.com/oraios/serena serena start-mcp-server --context ide-assistant` | 需本机装有 uv |
| DeepWiki | HTTP | `https://mcp.deepwiki.com/mcp` | — |
| Notion | HTTP | `https://mcp.notion.com/mcp` | 首次连接需浏览器授权 |
| Exa | HTTP | `https://mcp.exa.ai/mcp` | — |
| GitHub | HTTP | `https://api.githubcopilot.com/mcp/` | GitHub PAT |
| Brave Search | stdio | `npx -y @modelcontextprotocol/server-brave-search` | Brave API Key |

## 3. 在线搜索（官方 Registry）

| 项 | 行为 |
|---|---|
| 端点 | 固定 `https://registry.modelcontextprotocol.io/v0/servers`，不接受自定义地址 |
| 分页 | 每页 100 条；列表底部「加载更多（官方 Registry）」 |
| 过滤 | 只展示可运行条目：npm / pypi 包，或公网 https 的 `streamable-http` 远端 |
| 去重 | 内置目录优先；Registry 同 id 条目不会覆盖内置模板 |
| 失败降级 | 超时（8s）、网络错误、非 2xx、响应过大、JSON 异常 → 顶部黄色提示条，内置目录照常可安装 |
| 查询长度 | 截断到 200 字符 |

## 4. 安装流程

1. 在市场卡片点「安装」。
2. 按表单填写模板声明的值（`requiredEnv`），留空的必填项会阻止提交。
3. 对话框底部预览最终命令/URL；http 模板会列出将要发送的请求头名。
4. 点「安装」→ 走与手工新增完全相同的校验与落盘路径。
5. **stdio 服务器**会弹出「确认执行本机命令」，确认后才保存；取消则不会留下任何配置。
6. 安装成功后自动切回「已安装」Tab，并触发一次连接测试。

### 覆盖安装

若已存在同 `id` 的服务器，按钮变为「覆盖安装」，对话框会提示将覆盖现有配置（包括 disabledTools 会被重置）。

## 5. 安全与限制

- 市场模板只能来自内置目录或官方 Registry，渲染层不能提交任意 URL 让主进程请求。
- 安装时主进程会重新校验模板：stdio 命令禁止 `..`，http 必须公网 https，占位符必须在 `requiredEnv` 声明。
- `optional` 值为空时对应 env/header 会被丢弃，不会把字面量 `${...}` 传给子进程。
- 未实现：自定义市场来源、OAuth 授权码流程、第三方客户端配置导入。

## 6. 故障排查

| 现象 | 处理 |
|---|---|
| 顶部提示「在线搜索超时/请求失败」 | 内置目录仍可用；检查网络或公司代理，稍后重试 |
| 搜索不到某个服务器 | Registry 只索引其登记的条目；可到「已安装 → 新增服务器」手动配置 |
| 安装后状态「连接失败」+ `spawn ... ENOENT` | 命令不在 PATH（如 `uvx` 未安装）；按提示安装依赖，或在已安装 Tab 编辑命令为绝对路径 |
| 安装时没有弹出命令确认 | 只对 stdio 且首次启用/命令变化时确认；http 服务器不弹 |
| 卡片显示「已安装」但功能不可用 | 到「已安装」Tab 点「测试」查看具体错误，或检查工具级开关 |
