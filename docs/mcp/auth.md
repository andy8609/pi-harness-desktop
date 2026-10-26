# T13 授权确认与 OAuth

## 1. 实际落地形态：授权确认（降级方案）

源项目的 OAuth 实现（`mcp-oauth.ts`，874 行）依赖 `host-core` 的 secret ref 与系统 keyring。当前项目没有凭证系统，完整移植需要额外引入 `safeStorage` 凭据层 + 本机回调服务器 + DCR + PKCE + token 刷新，超出本次主链路预算。因此按 T3/D13 的决策**降级实现**：

### 1.1 stdio 命令确认

- 触发点：`McpService.upsert()`（`src/main/mcp/service.ts`）。
- 条件：`transport === "stdio"`、`enabled === true`、且不是「同一命令已启用」的重复保存。
- 交互：`DialogBroker.confirm("确认执行本机命令", "MCP 服务器「<label>」将在本机启动：\n<command> <args…>")`，由 `DialogHost` 渲染为确认弹窗。
- 拒绝：新增记录被删除；已有记录回滚为 `enabled: false`；返回 `{ cancelled: true }`，UI 提示「未确认命令，服务器没有启用」。
- 确认框自身失败（窗口已关闭等）：按未授权处理，绝不默认放行。
- 同一命令再次保存（改名称/描述）不会重复弹窗；命令或参数变化会重新确认。

### 1.2 远程 401/403 引导

- `McpClient` 在 HTTP 非 2xx 时抛 `HTTP_ERROR`，消息含状态码。
- `McpRuntime` 把 401/403 映射为 `status.authRequired = true` + `state = failed`。
- 设置页在状态行显示「需要授权」徽标；`describeMcpToolError` 对 401/403 给出明确指引：
  「请在服务器配置的 headers 中填写 Authorization」。
- 用户替代路径：在编辑表单的「请求头」里填写 `Authorization: Bearer <token>`（默认密码框显示，可切换显示）。

## 2. 未实现：完整 OAuth

| 能力 | 源项目 | 本次 | 原因 |
|---|---|---|---|
| OAuth 元数据发现 | ✅ `.well-known/oauth-protected-resource` | ❌ | 依赖 DCR 客户端身份；无凭证存储 |
| 动态客户端注册（DCR） | ✅ | ❌ | 同上 |
| PKCE + 本机回调服务器 | ✅ | ❌ | 需要长期维护的回调生命周期与端口占用处理 |
| token 持久化 / 刷新 | ✅（keyring secret ref） | ❌ | 当前项目无加密凭据存储 |
| `Authorization` 手动配置 | ❌（走 OAuth） | ✅ | 覆盖绝大多数远程 MCP 服务的 API Key / PAT 场景 |

**影响面**：只影响「必须走 OAuth 授权码流程」的远程服务器（例如部分 SaaS 官方 MCP 服务）。使用 Bearer Token / API Key 的服务器不受影响。

**后续补齐建议**：在 `McpServiceOptions.getAccessToken`（已预留）上接入一个基于 `safeStorage` 的 token 存储 + OAuth 流程模块，即可在不改动 runtime/工具层的前提下补上完整 OAuth。

## 3. 验收对照

| 标准 | 结果 |
|---|---|
| 需授权的服务器在授权完成前不建立连接 | ✅ stdio 未确认即不保存/不连接（`mcp-service.test.mjs` 覆盖） |
| 授权信息不落明文配置文件 | ⚠️ 与源项目一致：`env`/`headers` 明文存 `mcp-servers.json`；UI 默认掩码显示。完整加密存储不在本次范围 |
| 授权失败/失效可重试且状态可观测 | ✅ 状态 `failed` + `authRequired` + 重新测试/重连按钮 |
| 文档记录实际实现而非设想 | ✅ 本文档 |
