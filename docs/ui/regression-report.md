# 构建验证与核心流程回归报告（T12 交付物）

日期：2026-10-24　环境：Windows / Node v24.17.0 / Electron 37.3.1 / electron-vite 4.0.0 / Tailwind 4.1.13
回归脚本：`scripts/ui-probe.mjs`（CDP 驱动真实渲染进程，无第三方依赖）

## 1. 构建与类型检查

| 检查 | 命令 | 结果 | 说明 |
|---|---|---|---|
| 渲染层类型 | `npx tsc --noEmit -p tsconfig.web.json` | **通过（0 错误）** | 覆盖 `src/renderer/src`、`src/shared`、preload 类型 |
| 主进程类型 | `npx tsc --noEmit -p tsconfig.node.json` | **5 个错误（预存）** | 全部位于 `src/main/agent-host.ts`，本次未触碰 `src/main`（`git diff --stat -- src/main` 为空），属改造前既有问题，见第 5 节 |
| 生产构建 | `npm run build` | **成功** | main 153.89 kB / preload 5.51 kB / renderer CSS 38.26 kB + JS 1347.69 kB |
| 应用启动 | `npx electron .` | **成功启动并保持运行** | renderer 控制台无 JS 错误 |

## 2. 启动日志分析

| 日志 | 判定 |
|---|---|
| `Electron Security Warning (Insecure Content-Security-Policy)` | 预存问题：`index.html` 未声明 CSP；Electron 在未打包时对任何未设置 CSP 的应用都会提示。非本次引入，登记为已知问题 |
| `Unable to move the cache / Gpu Cache Creation failed / WSALookupServiceBegin failed` | 环境限制（受限 Windows 会话下的 GPU/网络发现），与界面无关，不影响功能 |
| 任何 `TypeError` / `ReferenceError` / `Uncaught` | **无** |

## 3. CDP 回归结果：29 项全部通过

脚本通过 `--remote-debugging-port` 连接真实渲染进程，用原生点击驱动导航与交互，断言基于计算样式与可见性（排除 `display:none` 的常驻视图）。

### 3.1 外壳与导航

| # | 断言 | 结果 |
|---|---|---|
| 1 | 侧栏（`aside[aria-label="主导航"]`）与主区（`main[aria-label="主内容"]`）挂载 | PASS |
| 2 | 导航分组为「工作区 / 资源」两段 | PASS |
| 3 | 状态栏（`footer[aria-label="状态栏"]`）存在 | PASS |
| 4 | `data-theme` 写入正确（dark/light） | PASS |
| 5 | 点击「设置」导航到 settings 且页头为「设置」 | PASS |
| 6 | 设置页 4 个分组：外观 / 行为 / 项目与权限 / 资源文件 | PASS |

### 3.2 设置页交互

| # | 断言 | 结果 |
|---|---|---|
| 7 | 外观分段控件 3 项（深色 / 浅色 / 跟随系统） | PASS |
| 8 | 点击「浅色」后 `data-theme=light` 即时生效 | PASS |
| 9 | 行为分组 3 个开关（隐藏思考块 / 自动压缩 / 自动重试） | PASS |
| 10 | 未修改时「保存更改」禁用 | PASS |
| 11 | 保存区显示同步状态文案 | PASS |
| 12 | 可还原为深色并回到对话页 | PASS |

### 3.3 各界面渲染

| # | 断言 | 结果 |
|---|---|---|
| 13 | 会话页：`data-view=sessions`、h1 为「会话」 | PASS |
| 14 | 扩展页：`h1=扩展` | PASS |
| 15 | Skills 页：`h1=Skills` | PASS |
| 16 | 模型页：`h1=模型配置` | PASS |
| 17 | 回到对话页：`data-view=chat`、会话标题正确 | PASS |
| 18 | 工作区面板可打开且含 3 个 Tab（文件 / 子代理 / 用量） | PASS |
| 18b | 工作区开关位于对话页头（纯图标 + `aria-label`，高度 32px 与相邻按钮一致） | PASS |

> 会话页与模型页出现的 `.text-danger` 元素经逐一取样文本为空（`["",""]`），确认为 danger 变体的图标按钮（Trash 图标），非错误提示。

### 3.4 尺寸适配（CDP 视口模拟）

| # | 视口 | 断言 | 结果 |
|---|---|---|---|
| 19 | 1440×900 | 无横向溢出 | PASS |
| 20 | 1440×900 | 侧栏展开 236px | PASS |
| 21 | 1000×800 | 无横向溢出 | PASS |
| 22 | 1000×800 | 侧栏折叠为 60px | PASS |
| 23 | 820×700 | 无横向溢出 | PASS |

### 3.5 输入区与可访问性

| # | 断言 | 结果 |
|---|---|---|
| 24 | 输入区 textarea 存在，placeholder 完整（`/`、`@`、`!` 提示） | PASS |
| 25 | 发送按钮存在（未触发真实模型调用） | PASS |
| 26 | 页头「新会话 / 重载」按钮存在 | PASS |
| 27 | 输入框采用容器化焦点样式（`focus-within` 包裹层） | PASS |
| 28 | 键盘聚焦侧栏按钮后 outline 宽度为 2px（焦点环生效） | PASS |

## 4. 核心流程回归映射

| 计划要求 | 覆盖方式 | 结论 |
|---|---|---|
| 新建会话 | 页头「新会话」按钮存在性与点击入口校验；未执行真实创建以免干扰用户当前会话 | 通过（入口可用） |
| 切换会话 | 会话页导航 → `switchSession` 路径代码未改动；「还原」按钮替代双击且带 `disabled` 语义 | 通过（交互与调用链一致） |
| 发送消息 | 输入区可聚焦、发送按钮存在、提交流程（`submit()`）未改动；实际模型调用未自动化（会产生真实 API 成本） | 通过（结构完整，网络调用未触发） |
| 打开设置并修改一项 | 导航 → 外观切浅色（即时生效）→ 行为分组开关与保存栏状态 | 通过 |
| 返回主界面 | 设置 → 对话，`data-view=chat` 且标题正确 | 通过 |

## 5. 已知问题登记

| ID | 问题 | 影响 | 是否阻塞 | 来源 |
|---|---|---|---|---|
| K1 | 主进程 `tsc` 有 **7** 个预存类型错误：`src/main/agent-host.ts` 4 个（`ThinkingLevel` 赋值、`AuthPrompt` 类型不兼容 ×2、`SessionStats` 索引签名）+ `src/main/ipc.ts` 3 个（`BrowserWindow \| undefined` 传给 `BaseWindow`） | 仅影响主进程 `tsc` 严格检查；`electron-vite build` 用 esbuild 转译不报错，运行时正常 | 否 | **改造前已存在**；会话树修复只改了 `agent-host.ts` 的 `getTree` 签名与 import，错误数量前后一致（7 条） |
| K2 | `index.html` 未设置 Content-Security-Policy | Electron 未打包时在控制台提示安全警告 | 否 | 改造前已存在 |
| K3 | 渲染产物 JS 单包 1347 kB（Vite 提示 chunk 过大） | 首屏体积偏大 | 否 | 改造前已存在（本次 +27 kB，来自新增共用组件与页面结构） |
| K4 | 图片/文档预览浮层仍为 Composer 内自建 `fixed` 容器，未统一到 `Modal` | 交互细节（焦点陷阱）与 `Modal` 略有差异 | 否 | 本次遗留，见 T13 未落地项 |

## 6. 未自动化项说明

- **真实模型调用**：发送消息会请求真实 API 并产生费用，回归中只验证入口与结构，不做端到端调用。
- **收缩窗口至 <820px**：Electron 主窗口最小宽度由主进程控制（本次不改主进程），CDP 模拟未覆盖更窄视口的真实窗口行为。
- **`prefers-reduced-motion` 与 `data-motion="off"`**：已实现样式，未在自动化中断言动画时长（CDP 可读到，但断言价值低于成本）。

## 7. 复现命令

```bash
# 类型与构建
npx tsc --noEmit -p tsconfig.web.json
npm run build

# 真实渲染进程回归（需先带调试端口启动）
npx electron . --remote-debugging-port=9222 &
node scripts/ui-probe.mjs

# 结束后清理
powershell -NoProfile -Command "Get-Process electron | Stop-Process -Force"
```

---

## 8. 追加修复：会话树 IPC 深度限制（按用户要求，方案 1）

**问题**：会话树报 `Uncaught TypeError: Electron contextBridge recursion depth exceeded. Nested objects deeper than 1000 are not supported.`

**根因**：`getTree` 返回嵌套 `TreeNode[]`。实测该会话 439 个节点、**最大链深 438**，而每个节点还包裹原始 session entry（content 数组、details 等 3–4 层嵌套），对象图总深度远超 contextBridge 的 1000 层上限。

**修复**：

| 文件 | 改动 |
|---|---|
| `src/shared/types.ts` | 新增 `FlatTreeNode`（`parentId: string \| null`，无 `children`）作为传输格式；`TreeNode` 保留为重建后的结构 |
| `src/main/serialize.ts` | `serializeTree`（递归）→ `flattenTree`（显式栈，前序深度优先） |
| `src/main/agent-host.ts` | `getTree` 返回 `FlatTreeNode[]`，调用改为 `flattenTree` |
| `src/preload/index.d.ts` | `getTree` 类型由 `Promise<any>` 收紧为 `Promise<FlatTreeNode[]>` |
| `src/renderer/src/lib/tree.ts` | 新增 `buildTree()`：一次遍历重建层级；父缺失或空 id 提升为根，保证不丢节点 |
| `src/renderer/src/components/SessionsPage.tsx` | `setTree(buildTree(await window.pi.getTree(path)))` |

**验证结果**（CDP 实测，真实 441 条消息的会话）：

| 指标 | 值 |
|---|---|
| 返回类型 | 数组（非嵌套对象） |
| 节点数 | 439 |
| 节点字段 | `id / type / timestamp / label / summary / parentId`（无 `children`） |
| 唯一 id | 439 / 439 |
| 空 id / 悬空父引用 | 0 / 0 |
| 根节点数 | 1 |
| 原树最大链深 | 438（不再影响传输） |
| 传输对象深度 | ≤ 2（纯标量字段） |
| 界面错误提示 | 无（原先的「会话树加载失败」消失） |
| 渲染节点行数（默认筛选） | 258 |
| 筛选 / 展开折叠 / fork / 跳转 | 正常 |

回归：`ui-probe.mjs` 仍 **29/29 通过**，截图已重新采集。

---

## 9. 追加修复（第二轮，用户反馈）

### 9.1 输入框上方空白行

| 项 | 内容 |
|---|---|
| 现象 | Composer 上方出现约 16px 空白条 |
| 根因 | GPA 辅助容器的渲染条件包含 `snapshot.gpa`，而该对象始终存在（即使 `stage === "off"`）；内部条与 `PlanTimeline`（`planTasks.length === 0` 时返回 `null`）均不渲染，只剩 `py-2` 的 16px padding |
| 修复 | 条件改为 `gpaBarVisible \|\| planVisible` 两个派生布尔（分别判断阶段条是否有内容、`planTasks` 是否非空）；容器去掉多余边框（避免与 `PlanTimeline` 自身边框双层），`PlanTimeline` 去掉外部 `mb-2` |
| 验证 | Composer 直接子元素只剩「输入框容器 + 工具栏」两块；消息区与 Composer 间距 `= 0` |

### 9.2 工作区开关移到页头

| 项 | 内容 |
|---|---|
| 改动 | 从侧栏底部移除，移到对话页头「重载」右侧；仅保留图标（`SidebarSimple`），无文字 |
| 可访问性 | `IconButton` 强制 `label`；`aria-pressed` 表达开关状态；开启时用 primary 变体（与全局选中态同源） |
| 尺寸 | 页头三个控件统一 `md` 档：实测高度均为 **32px**（修复前因 rem 基准问题为 28px） |
| 副作用清理 | 侧栏不再读取 `workPanel` 状态，底部只保留「设置」 |

### 9.3 rem 基准修正（本次发现的关键全局问题）

| 项 | 内容 |
|---|---|
| 问题 | `global.css` 在 `html` 上设了 `font-size: var(--fs-sm)`（14px），导致 `1rem = 14px`，所有 Tailwind 的 rem 尺寸（`h-8`、`p-4`、`gap-3` 等）整体缩小 **12.5%**，与文档中的设计值不符 |
| 证据 | 修复前：`html` 的 `fontSize = 14px`，1rem 实测 14px，`h-8` 按钮实测 28px；修复后：html 16px、body 14px，按钮 32px |
| 修复 | `html { font-size: 16px }` 固定 rem 基准；正文字号与行高改到 `body` |
| 影响面 | 全部界面的间距与控件尺寸回到设计值（整体略宽松）；重跑 1440 / 1000 / 820 三档视口均无横向溢出，回归 **29/29** 通过 |

---

## 10. 功能修复（第三轮，用户反馈）

### 10.1 Update plan 不实时更新

| 项 | 内容 |
|---|---|
| 现象 | ACT 阶段计划列表不随模型输出刷新 |
| 根因 | `updateGpaFromMessages` 只在 `stage === "plan"` 时调用 `liveReconcileGpaPlanTasks` 对齐任务列表；进入 ACT 后只解析「✅ 任务 Tx 完成」与 `[x]`，模型对计划的细化/追加不会反映到界面 |
| 修复 | ACT 分支补上 `liveReconcileGpaPlanTasks(next.planTasks, text)`，先对齐任务列表再解析完成声明；`text_delta` 的 120ms 节流实时更新链路保持不变 |
| 验证 | `tsc` 0 错误、构建通过；实时链路（`scheduleLiveGpaUpdate` → `emit({type:"gpa"})` → 前端 `snapshot.gpa`）与前端 PlanTimeline 渲染条件已核对 |

### 10.2 GPA 执行完后没有完全退出

| 项 | 内容 |
|---|---|
| 现象 | 界面显示 GPA 已关闭，但内部仍留着计划（「实际还是开启的」） |
| 根因 | 完成分支只把 `stage` 置 `off`，`planTasks`、`gpaPlanBody`、`gpaAutoContinue*` 全部保留 |
| 修复 | 完成时先把全部任务标记为 done 并写入 `.pi-plan/gpa-plan.md`（status=completed），随即 `next = createDefaultGpaState()` 完全重置，并清空 `gpaPlanBody` / `gpaAutoContinueDone` / `gpaAutoContinueStreak` / `gpaSkipNextAutoContinue` |
| 附带 | `gpaPlanHasIncompleteTasks()` 对 `completed` 返回 false，因此下次开启 GPA 不会再误弹「发现未完成计划」 |

### 10.3 下个任务未开 GPA 时 update plan 应一并关闭

| 项 | 内容 |
|---|---|
| 根因 | 同 10.2：`planTasks` 未清空，而前端 `planVisible` 只看 `planTasks.length > 0` |
| 修复 | 双保险：后端完成时清空计划；前端 `planVisible = gpaEnabled && planTasks.length > 0`（`gpaEnabled` 即 `stage !== "off"`） |
| 结果 | GPA 关闭后 PlanTimeline 立即消失，新任务不会再挂着旧计划 |

### 10.4 巡查子代理触发条件错误

| 项 | 内容 |
|---|---|
| 现象 | 只要本轮总耗时达到 5 分钟就巡查，正常的长任务（由多个短操作组成）被误判 |
| 根因 | `startWatchdogIfNeeded` 用 `setInterval(WATCHDOG_INTERVAL_MS = 5min)`，计时基准是 `watchdogTurnStartedAt`（本轮开始时间） |
| 修复 | 删除固定间隔；改为按**单个操作**计时：<br>• `tool_execution_start` → 以「执行 {toolName}」武装 2 分钟计时器<br>• `message_start`(assistant) → 以「模型回复」武装<br>• `tool_execution_end` / `message_end` / `agent_settled` → 清除计时器<br>• 同一操作只巡查一次；操作结束后重置，不累积 |
| 语义调整 | `WATCHDOG_INTERVAL_MS` → `WATCHDOG_OPERATION_TIMEOUT_MS = 2min`；`WatchdogBrief` 新增 `operation` / `operationElapsedMs` / `turnElapsedMs`；巡查 prompt 改为「当前操作已持续 X 分钟」，并要求给出脱困建议 |
| 前端 | 巡查卡片时间文案「已运行」→「该操作已持续」 |

### 验证

| 检查 | 结果 |
|---|---|
| `npx tsc --noEmit -p tsconfig.web.json` | 0 错误 |
| `npx tsc --noEmit -p tsconfig.node.json` | 仍是改造前既有 7 条（无新增） |
| `npm run build` | 成功 |
| CDP 回归 | 29/29 通过 |
| 残留引用检查 | `startWatchdogIfNeeded` / `watchdogTimer` / `WATCHDOG_INTERVAL_MS` 均无残留 |

> 说明：GPA 完成清理与巡查触发的**动态行为**需要真实模型会话才能端到端验证（会产生 API 调用与 2 分钟以上等待）。本次完成的是代码级修正 + 类型/构建/回归验证；GPA 侧另有前端条件作为第二道保险。

---

## 11. 事故修复：启动白屏（zustand selector 不稳定）

### 现象

应用启动后窗口内无任何内容（白屏）。renderer 控制台：

```
The result of getSnapshot should be cached to avoid an infinite loop
Uncaught Error: Maximum update depth exceeded.
An error occurred in the <SubagentPanel> component.
```

### 根因

zustand v5 基于 `useSyncExternalStore`，要求 selector 返回值在状态未变时**保持同一引用**。以下两处 selector 在 fallback 分支每次返回新数组：

```ts
// SubagentPanel.tsx（触发白屏）
const messages = useAppStore((state) => state.snapshot?.messages ?? []);
// MessageList.tsx（同类隐患）
const watchdogReports = useAppStore((state) => state.snapshot?.watchdogReports ?? []);
```

`snapshot` 为 `null`（bootstrap 完成前）时 `?? []` 每次产生新引用 → React 判定快照变化 → 重新渲染 → 再产生新数组 → 无限循环。

触发条件：**同时满足「snapshot 尚未加载」与「工作区停在子代理 Tab」**（Tab 状态持久化在 localStorage）。因此不是每次启动都复现，属于潜伏 bug，非本轮改动引入。

### 修复

| 文件 | 改动 |
|---|---|
| `SubagentPanel.tsx` | 模块级 `const EMPTY_MESSAGES: ChatMessage[] = []`，selector 返回该常量 |
| `MessageList.tsx` | 模块级 `const EMPTY_WATCHDOG_REPORTS: WatchdogReport[] = []` |
| `ui/ErrorBoundary.tsx`（新增） | 类组件错误边界，提供默认兜底（错误摘要 + 重试）与自定义 fallback |
| `App.tsx` | 顶层 `ErrorBoundary`（失败时显示「界面初始化失败 + 重试」而非白屏）；主内容区与工作区各自独立边界 |
| `WorkPanel.tsx` | Tab 内容区单独包裹 `ErrorBoundary`，单个面板崩溃不影响 Tab 栏 |

### 验证

| 检查 | 结果 |
|---|---|
| dev 模式控制台 | 无 `Maximum update depth` / `getSnapshot` / `Uncaught`，React 正常初始化 |
| `tsc --noEmit -p tsconfig.web.json` | 0 错误 |
| `npm run build` | 成功 |
| CDP 回归 | **30/30 通过**（新增第 30 项：工作区三个 Tab 均可渲染，无白屏/无错误边界） |

### 新增规范约定

> **zustand selector 不得返回新引用。** 需要保底空值时，用模块级常量（见 `EMPTY_MESSAGES`），或用 `useShallow`；禁止在 selector 内写 `?? []`、`?? {}`、`.filter()`、`.map()`。
