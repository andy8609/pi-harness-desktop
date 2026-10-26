# T4 依赖与构建打包结论

## 1. 结论：无需新增任何 npm 依赖

设计决策 D1 选定移植源项目自研 JSON-RPC 客户端，只使用 Node/Electron 内置能力：

| 能力 | 来源 | 是否需要 externals 配置 |
|---|---|---|
| `child_process.spawn` | Electron main（Node 22.23.2） | 否（内置模块） |
| `fetch` / `AbortController` | Electron 37 内置 Chromium/Node 全局 | 否 |
| `node:fs` / `node:path` / `node:os` | Electron main | 否 |
| `node:http`（T13 授权确认不需要；OAuth 未实现） | Electron main | 否 |

`electron.vite.config.ts` 已对 main/preload 启用 `externalizeDepsPlugin()`；本地相对导入会被打进 `out/main/index.js`，`node:` 内置模块保持外部引用。**不需要修改打包配置**。

`electron-builder.yml`：`files: [out/**/*, package.json]`、`asar: true`。stdio MCP 服务器是用户机器上的外部可执行文件，通过 `spawn` 从 asar 外部启动，不受打包影响。**不需要 `asarUnpack`**。

## 2. 验证记录

### 2.1 构建基线

```
$ npm run build
✓ 24 modules transformed        out/main/index.js    156.16 kB
✓ 1 modules transformed         out/preload/index.mjs  5.51 kB
✓ 4878 modules transformed      out/renderer/...       1.35 MB
```

### 2.2 类型检查基线

```
$ npx tsc -p tsconfig.web.json --noEmit     # 通过，0 错误
$ npx tsc -p tsconfig.node.json --noEmit    # 6 个既有错误（与 MCP 无关）
```

既有错误清单（T15 修复，不属 MCP 功能缺陷）：

| 文件:行 | 错误 |
|---|---|
| `src/main/agent-host.ts:1644` | `string` 不能赋给 `ThinkingLevel` |
| `src/main/agent-host.ts:1669` | `AuthPrompt` 与 SDK 的 readonly options 不兼容 |
| `src/main/agent-host.ts:1674` | `prompt.options` 可能为 undefined |
| `src/main/agent-host.ts:1833` | `SessionStats` 缺少索引签名 |
| `src/main/ipc.ts:118/129/140` | `BrowserWindow \| undefined` 不能传给 `showSaveDialog/showOpenDialog` |

MCP 新增代码的验收口径：**MCP 相关文件不得引入新的类型错误**；T15 一并修既有错误，使 `tsc -p tsconfig.node.json --noEmit` 全绿。

### 2.3 运行时能力探针（`scripts/mcp-env-probe.mjs`）

```
$ node scripts/mcp-env-probe.mjs
{
  "ok": true,
  "node": "v22.23.2",
  "stdio": { "tools": 5, "echo": "hello" },
  "http": { "url": "http://127.0.0.1:31542/mcp", "tools": 1 }
}
```

覆盖：
1. `spawn(process.execPath, ["scripts/mock-mcp-server.mjs"])` + 逐行 NDJSON 往返 → `initialize` / `notifications/initialized` / `tools/list` / `tools/call` 全部成功。
2. 全局 `fetch` POST JSON-RPC + `application/json` 响应解析 → `initialize` / `tools/list` / `tools/call` 全部成功。

## 3. 附带的测试基础设施

| 文件 | 用途 | 后续任务用处 |
|---|---|---|
| `scripts/mock-mcp-server.mjs` | 零依赖 MCP stdio 服务器，提供 `echo`/`add`/`fail`/`slow`/`big` 五个工具 | T6 生命周期联调、T8 结果归一化、T14 集成测试、T15 E2E |
| `scripts/mcp-env-probe.mjs` | 运行时能力探针（stdio + http） | 保留为环境自检脚本 |

## 4. T4 验收对照

| 验收项 | 结果 |
|---|---|
| 安装/构建不新增依赖 | ✅ 未改动 `package.json` 依赖 |
| `npm run build` 通过 | ✅ |
| 开发与打包产物可创建 MCP 客户端实例 | ⏳ 探针已证明 Node 运行时能力；打包产物验证在 T15（需启动 Electron 实测） |
| 依赖新增数量与体积增量记录 | ✅ 0 个新增依赖，0 体积增量 |
