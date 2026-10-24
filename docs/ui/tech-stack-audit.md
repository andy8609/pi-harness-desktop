# 前端技术栈与样式组织盘点（T2 交付物）

盘点日期：2026-10-24　范围：`D:/project/pi-harness-desktop`

## 1. 技术栈结论

| 层 | 结论 | 佐证 |
|---|---|---|
| 应用容器 | Electron 37.3.1 | `package.json` devDependencies `electron: 37.3.1` |
| 构建工具 | electron-vite 4.0.0 + Vite 7.1.5 | `package.json` scripts `build: electron-vite build`；`electron.vite.config.ts` |
| UI 框架 | React 19.1.1（`StrictMode`） | `src/renderer/src/main.tsx` |
| 语言 | TypeScript 5.9.2 | `package.json`；`tsconfig.web.json` |
| 样式方案 | **Tailwind CSS 4.1.13（v4，CSS-first，无 `tailwind.config.js`）** | `src/renderer/src/styles/global.css` 首行 `@import "tailwindcss";`；`electron.vite.config.ts:30` `tailwindcss()` 插件；仓库根目录无 tailwind 配置文件 |
| 现有令牌机制 | CSS 自定义属性，`:root` 为深色默认，`:root[data-theme="light"]` 覆盖 | `src/renderer/src/styles/global.css:3-66` |
| 主题切换 | `data-theme` + `data-theme-mode` 写到 `<html>`，同步主进程 | `src/renderer/src/lib/theme.ts` `applyTheme()` / `initTheme()` |
| 图标库 | `@phosphor-icons/react` 2.1.10 | `package.json`；各组件 `import { ... } from "@phosphor-icons/react"` |
| 状态管理 | `zustand` 5.0.8，单一 store | `src/renderer/src/stores/app-store.ts`（413 行） |
| Markdown | `react-markdown` 10.1.0 + `remark-gfm` 4.0.1 | `package.json`；`MessageList.tsx` |

**结论：不存在 Avalonia / XAML / AtomUI / 任何 C# 侧 UI 代码**，`llms.txt` 的控件层确实无法套用（见 `ui-spec-checklist.md` 第 0 节偏差声明）。

## 2. 目录结构与职责

```
src/
├─ main/            23 个文件，Electron 主进程（agent-host、ipc、prefs、permission-*）
├─ preload/         index.ts / index.d.ts，暴露 window.pi
├─ shared/          types.ts（AppView、ThemeMode 等）、gpa.ts
└─ renderer/
   ├─ index.html    lang="zh-CN"，挂载 #root
   └─ src/
      ├─ App.tsx                       应用外壳：Sidebar + main(视图切换) + WorkPanel + StatusBar
      ├─ main.tsx                      入口：initTheme() 后 createRoot
      ├─ components/                   32 个组件（含 models/ 子目录 4 个）
      ├─ hooks/useFollowScroll.ts
      ├─ lib/                          theme.ts、text.ts、tool-summary.ts、remote-models.ts、subagent-topology.ts
      ├─ stores/app-store.ts           视图状态、事件处理、bootstrap
      └─ styles/global.css             唯一全局样式文件（122 行）
```

**样式落点唯一**：`src/renderer/src/styles/global.css`。所有组件样式均为 Tailwind 内联 `className`，无 CSS Modules、无 styled-components、无 SCSS。

## 3. 界面清单与源码入口（供 T3 使用）

| 界面 | `AppView` 值 | 入口文件 | 载体 |
|---|---|---|---|
| 对话/主窗口 | `chat` | `components/ChatPane.tsx` | 常驻挂载，`hidden` 切换 |
| 会话 | `sessions` | `components/SessionsPage.tsx` | 条件挂载 |
| 扩展 | `extensions` | `components/ExtensionsPage.tsx` | 条件挂载 |
| Skills | `skills` | `components/SkillsPage.tsx` | 条件挂载 |
| 模型 | `models` | `components/ModelsPage.tsx` | 常驻挂载，`hidden` 切换 |
| 设置 | `settings` | `components/SettingsPage.tsx` | 条件挂载 |
| 全局外壳 | — | `App.tsx`、`components/Sidebar.tsx`、`components/StatusBar.tsx`、`components/WorkPanel.tsx` | 常驻 |
| 全局浮层 | — | `components/DialogHost.tsx`、`components/InlineDialogHost.tsx`、`components/Toasts.tsx` | 常驻 |

视图枚举定义：`src/shared/types.ts:4`
```ts
export type AppView = "chat" | "sessions" | "extensions" | "skills" | "models" | "settings";
```

## 4. 现有可复用组件清单

| 组件 | 路径 | 现状 |
|---|---|---|
| `Sidebar` | `components/Sidebar.tsx` | 232px 固定宽侧栏，含品牌区、打开目录、6 项导航、工作区开关、会话元信息 |
| `StatusBar` | `components/StatusBar.tsx` | 32px 底栏，左侧运行状态 + cwd，右侧 6 个 Stat + 模型名 |
| `WorkPanel` | `components/WorkPanel.tsx` | 右侧工作区，可折叠，含 `PanelResizeHandle` |
| `PanelResizeHandle` | `components/PanelResizeHandle.tsx` | 分栏拖拽手柄 |
| `ChatPane` | `components/ChatPane.tsx` | 会话页骨架：header + MessageList + MessageQueue + Composer |
| `MessageList` | `components/MessageList.tsx` | 消息渲染（353 行） |
| `Composer` | `components/Composer.tsx` | 输入区（647 行，样式密度最高） |
| `Toasts` | `components/Toasts.tsx` | 轻提示 |
| `DialogHost` / `InlineDialogHost` | 同名文件 | 模态与内联对话框 |
| `models/*` | `components/models/` | 模型页子组件（HeaderEditor、ModelSelectionPanes、ProviderDialog、ServicePicker） |

**缺失**：项目内**没有**任何共用布局组件（PageShell / PageHeader / SectionCard / EmptyState / Skeleton / Button 变体）。各页面各自拼 `className`，这是 T5 要补的层。

## 5. 现状问题摘要（供 T3 展开）

| 编号 | 现象 | 证据 |
|---|---|---|
| A1 | 令牌只有颜色维度，**缺字号、间距、圆角、阴影、动效** | `global.css:3-66` 仅定义 27 个颜色类变量 + 字体族 |
| A2 | 字号存在 4 档硬编码：9/10/11/12px | `text-[10px]`×25、`text-[11px]`×14、`text-[12px]`×3、`text-[9px]`×1（`grep` 统计） |
| A3 | 颜色令牌命名非语义化，主题切换依赖手动成对维护 | `--bg`/`--bg-panel`/`--bg-raised`/`--line`/`--text`… 两套手写，无推导 |
| A4 | 页面容器重复模板：`h-full overflow-auto px-6 py-5` ×4 处 | `SessionsPage.tsx:81`、`SettingsPage.tsx:42`、`ModelsPage.tsx:230`、`ExtensionsPage.tsx:75`、`SkillsPage.tsx:75` |
| A5 | 卡片模板重复：`rounded-xl border border-[var(--line)] bg-[var(--bg-panel)] p-4` ×5 | `grep` 统计 TOP 重复片段 |
| A6 | 无空态/骨架组件，列表加载与空数据表现不统一 | 组件清单第 4 节 |
| A7 | 滚动条样式全局硬编码 10px 宽 + 无边缘渐隐 | `global.css:100-110` |
| A8 | 焦点态缺失：全项目未定义 `:focus-visible` 样式，仅依赖浏览器默认与 `accent-color` | `global.css` 全文无 `focus` |
| A9 | 动效缺失：仅 `animate-spin` 一处 | `StatusBar.tsx` 忙碌指示器 |

## 6. 可改动范围（写入约束）

**允许改动**
- `src/renderer/src/**`（全部渲染层代码与样式）
- `docs/ui/**`（本文档树）
- 允许新增 `src/renderer/src/components/layout/*`、`src/renderer/src/styles/tokens.css`、`src/renderer/src/components/ui/*`

**禁止改动（本次范围外）**
- `src/main/**`、`src/preload/**`：主进程与 IPC 契约（改动会破坏功能，且不属于界面优化）
- `src/shared/**`：类型契约（`AppView` 值域、`ThemeMode`）
- `package.json` 依赖：不新增第三方 UI 依赖（硬性约束，见目标成功标准 5）
- `release/`、`out/`：构建产物目录

## 7. 对后续任务的影响

1. **T4 令牌层**必须用 Tailwind v4 的 `@theme inline` 把 CSS 变量映射为语义工具类，否则无法消除 A2/A3/A4/A5 的重复字面量；令牌文件与 `global.css` 的关系需保持「单一 `@import` 入口」。
2. **T5 共用组件**是 A4/A5/A6/A8 的唯一解，必须先落地再改页面，否则会制造第四套模板。
3. **T6–T9 页面改造**只允许做「结构重排 + 换成共用组件」，不得新增自造样式模板。
4. **T12 构建验证**以 `npm run build`（electron-vite build，含 `tsc` 路径）为准；`npm test` 为 `node --test test/*.test.mjs`，当前仓库无 `test/` 目录，回归以手工流程为主。
