# MCP（Model Context Protocol）使用说明

本目录记录 Pi Desktop 的 MCP 客户端实现、设计与验证。功能已从 `PI-Desktop-main` 迁移，按本项目的 Electron 架构重写装配层。

## 1. 能力概览

- 传输：**stdio**（本机子进程）与 **HTTP**（Streamable HTTP；响应可为 JSON 或 SSE）。
- 工具：连接后自动 `tools/list`，注册为 `mcp_<serverId>_<toolName>`，模型可直接调用。
- 状态：`idle / connecting / ready / failed`，错误原因展示在设置页。
- 隔离：单个服务器失败不影响其它服务器或对话；`tools/call` 失败不重试。
- 生命周期：应用启动连接全局服务器；切换项目重连该项目可见的服务器；退出时统一关闭子进程。
- 工具级开关：可单独禁用某个工具，不注册给模型。
- 市场：内置 15 条精选模板 + 官方 Registry 在线搜索，填表后一键安装（见 `market.md`）。

## 2. 配置文件

| 项 | 值 |
|---|---|
| 默认路径 | `~/.pi/agent/mcp-servers.json`（Windows：`C:\Users\<user>\.pi\agent\mcp-servers.json`；与 pi CLI 配置同目录） |
| 覆盖路径 | 环境变量 `PI_MCP_CONFIG_PATH`（绝对路径，测试/多实例用） |
| 格式 | `{ "version": 1, "servers": [ ... ] }` |
| 写入 | 临时文件 + rename 原子替换；文件损坏时备份为 `mcp-servers.json.corrupt-<时间戳>.json` 并以空配置启动 |

### 服务器字段

| 字段 | 必填 | 说明 |
|---|---|---|
| `id` | 是 | 字母开头，`[A-Za-z0-9_-]{0,63}`；决定工具名前缀 |
| `label` | 否 | 显示名称，默认取 `id` |
| `description` | 否 | 帮助模型判断何时使用 |
| `transport` | 是 | `stdio` \| `http` |
| `command` | stdio | PATH 命令名或绝对路径；禁止 `..` 与相对路径 |
| `args` | stdio | 字符串数组，≤ 64 项 |
| `env` | stdio | 环境变量键值，≤ 64 项；键名 `[A-Za-z_][A-Za-z0-9_]*` |
| `url` | http | 绝对地址，仅 `http:` / `https:` |
| `headers` | http | 请求头，≤ 32 项；凭据建议放这里 |
| `enabled` | 否 | 默认 `true` |
| `scope` | 否 | `{ mode: "global" }` 或 `{ mode: "projects", projects: ["D:/work/a"] }` |
| `disabledTools` | 否 | 不注册给模型的工具名列表 |

### 示例

```json
{
  "version": 1,
  "servers": [
    {
      "id": "filesystem",
      "label": "Filesystem",
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "D:/work"],
      "env": { "LOG_LEVEL": "info" },
      "enabled": true,
      "scope": { "mode": "global", "projects": [] },
      "createdAt": "2026-01-01T00:00:00.000Z",
      "updatedAt": "2026-01-01T00:00:00.000Z"
    },
    {
      "id": "remote-docs",
      "label": "Remote Docs",
      "transport": "http",
      "url": "https://mcp.example.com/mcp",
      "headers": { "Authorization": "Bearer <token>" },
      "enabled": true,
      "scope": { "mode": "projects", "projects": ["D:/work/a"] },
      "createdAt": "2026-01-01T00:00:00.000Z",
      "updatedAt": "2026-01-01T00:00:00.000Z"
    }
  ]
}
```

## 3. 在界面里配置

侧边栏 **资源 → MCP**（位于 Skills 下方）：


1. **新增服务器**：填 ID、名称、传输方式；stdio 填命令与参数（参数按命令行写法，含空格的参数用引号），HTTP 填 URL 与请求头。
2. **保存**：stdio 服务器首次启用会弹出「确认执行本机命令」，确认后才保存并连接。
3. **测试**：强制重新握手，结果直接显示在状态行与提示里。
4. **工具**：展开查看最近一次握手的工具清单，可逐个禁用。
5. **启用/停用**：停用立即断开并移除工具，配置保留。
6. **删除**：点击一次进入待确认状态，再点一次才删除。
7. **市场**：切到「市场」Tab，浏览内置目录或在线搜索官方 Registry，点「安装」填写模板需要的值即可。

## 4. 安全策略

| 项 | 行为 |
|---|---|
| stdio 环境 | 只透传 `PATH/SystemRoot/windir/TEMP/TMP/TMPDIR/LANG` + `NODE_ENV` + 用户声明值，不继承宿主密钥 |
| stdio 命令 | 不经过 shell；拒绝 `..` 与相对路径 |
| 用户确认 | stdio 首次启用或命令变化时展示完整命令行并要求确认 |
| 远程凭据 | 401/403 时提示在 headers 填 `Authorization`；UI 默认以密码框显示 |
| 资源上限 | 单行/响应 4 MiB、工具 64 个/服务器、活跃服务器 16 个、`tools/list` 8 页、重定向 5 跳、连接 10 s、调用 100 s |
| 明文存储 | `env`/`headers` 与源项目一致，明文存于配置文件（未实现加密凭据库） |

## 5. 故障排查

| 现象 | 排查 |
|---|---|
| 状态「连接失败」+ `spawn ... ENOENT` | 命令不在 PATH；改成绝对路径（Windows 可用 `where node` 查找）。Windows 的 `npx`/`npm`/`pnpm`/`yarn` 会自动经 `cmd.exe` 包装，无需手写 `cmd /c` |
| 状态「连接失败」+ 超时 | 服务器启动慢或未实现 `initialize`；先手动在终端运行同一命令 |
| 状态「连接失败」+ 401/403 | 在请求头填 `Authorization`；或该服务只支持 OAuth（未实现，见 `auth.md`） |
| 工具列表为空 | 先点「测试」；服务器可能未声明 `tools` 能力 |
| 工具没有出现在对话中 | 检查服务器是否启用、scope 是否包含当前项目、工具是否被禁用、是否处于 GPA 的 GOAL/PLAN 阶段（该阶段禁用一切工具） |
| 退出后仍有 `node` 进程 | 正常路径会在退出时 `kill`；若崩溃残留，手动结束对应进程 |

## 6. 开发者接入点

| 文件 | 职责 |
|---|---|
| `src/shared/mcp.ts` | 类型、限制常量、校验/命名/scope 纯函数 |
| `src/main/mcp/client.ts` | JSON-RPC 客户端 + stdio/HTTP 传输 |
| `src/main/mcp/runtime.ts` | 多服务器生命周期、工具缓存、调用路由 |
| `src/main/mcp/store.ts` | 配置读写与校验 |
| `src/main/mcp/tools.ts` | 描述符 → pi 工具定义、激活集合同步 |
| `src/main/mcp/content.ts` | `tools/call` 结果与错误归一化 |
| `src/main/mcp/service.ts` | 门面：配置 + 运行时 + 工具桥 + 广播 |
| `src/main/mcp/ipc.ts` | `mcp:` IPC 通道 |
| `src/main/extensions/mcp.ts` | 注入 pi 扩展 |
| `src/renderer/src/components/mcp/*` | 设置页 UI |

扩展 OAuth：实现 `McpServiceOptions.getAccessToken(serverId)` 并注入即可，runtime 会自动加 `Authorization: Bearer`。

## 7. 测试

```bash
npm test                                                    # 42 个 MCP 用例
node scripts/e2e-mcp-electron.mjs                           # 开发产物端到端
PI_E2E_BINARY="release/win-unpacked/Pi Desktop.exe" \
  node scripts/e2e-mcp-electron.mjs                         # 打包产物端到端
```

其他文档：`market.md`（市场使用）、`market-baseline.md` / `market-design.md`（市场基线/设计）、`migration-baseline.md`（源项目基线）、`integration-points.md`（本项目集成点）、`design-decisions.md`（决策）、`ui-inventory.md`（UI 与开关清单）、`ipc-contract.md`（IPC 契约）、`auth.md`（授权）、`testing.md`（测试清单）、`e2e-report.md`（实测报告）、`feature-parity.md`（对照清单）、`CHANGES.md`（文件与回滚）。
