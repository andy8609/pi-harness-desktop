# 界面改造前后对比说明（逐任务累积）

本文件按任务粒度记录布局与信息架构变更，作为 `T13` 汇总报告的原始材料。

---

## T6 主窗口（全局外壳）— S0

**改动文件**：`components/Sidebar.tsx`（重写）、`components/StatusBar.tsx`（重写）、`components/WorkPanel.tsx`（用量面板）、`App.tsx`（主区容器）

### 区域层级：改造前 → 改造后

| 层级 | 改造前 | 改造后 |
|---|---|---|
| 主（Primary） | 主内容区与侧栏权重相同，侧栏品牌区占据最高视觉权重 | 主内容区为唯一视觉重心；侧栏压缩为导航辅助层 |
| 次（Secondary） | 侧栏导航 6 项平铺，设置与对话同级 | 侧栏分「工作区 / 资源」两组，设置沉到工具区 |
| 辅（Tertiary） | 状态栏 8 项统计常显，与工作区用量重复 | 状态栏 3 项（上下文/花费/模型），明细归口工作区 |

### 逐项变更

| 审计项 | 改造前 | 改造后 |
|---|---|---|
| S0-1 | 品牌区两行「PI DESKTOP / 工作台」，高约 60px | 单行「Pi」标记 + Pi Desktop，高 44px；「工作台」删除（不对应任何界面） |
| S0-2 | 侧栏底部显示会话名/模型/扩展数/Skills 数/版本 | 该区块整体删除；会话名在对话页头，模型与统计在状态栏与工作区 |
| S0-3 | 6 项导航平铺，设置与对话平级 | 分组：`工作区`（对话、会话）/ `资源`（扩展、Skills、模型）；设置移入底部工具区 |
| S0-4 | 「打开项目目录」为侧栏中间的边框按钮 | 升级为项目卡片：已打开时显示项目名 + 短路径，悬停提示完整路径；未打开时显示「打开项目目录 / 选择工作目录后开始对话」 |
| S0-5 | 「打开/收起工作区」夹在导航与元信息之间 | 移入底部工具区，与设置相邻，`aria-pressed` 表达状态 |
| S0-6 | 状态栏右侧 8 个 Stat + 模型 | 右侧仅「上下文 / 花费 / 模型」；输入、输出、缓存读、缓存写移出（工作区「用量」为唯一明细入口）；思考等级保留在工作区用量 |
| S0-7 | 无焦点样式 | 全局 `:focus-visible` 使用 `--focus-ring`（2px + 2px offset） |
| S0-8 | 无窄窗口策略，232px 侧栏 + 260px 工作区挤压主区 | ≤1180px 时侧栏自动收为 60px 图标栏（文字隐藏，`title` 提供名称）；主区设 `min-w-[320px]` |

### 导航状态语义

- 当前页：`aria-current="page"` + 强调色实心填充（与 `SegmentedControl` 选中态同源）。
- 工作区开关：`aria-pressed`，不使用强调色填充（它不是导航目的地）。
- 侧栏容器：`<aside aria-label="主导航">`，主区：`<main aria-label="主内容" data-view={view}>`。

### 验收

- `npx tsc --noEmit -p tsconfig.web.json`：0 错误
- `npm run build`：成功，产物 CSS 含 `max-width: 1180px` 媒体查询（窄窗折叠生效）
- 焦点环、`aria-current`、`aria-pressed`、`aria-label` 均已就位

---

## T7 对话页（主工作区）— S1

**改动文件**：`components/ChatPane.tsx`（重写）、`components/Composer.tsx`（输入区分区）、`components/MessageList.tsx`（空态与按钮统一）

### 信息架构：改造前 → 改造后

```
改造前                         改造后
─────────────────────────      ─────────────────────────
header（标题/操作混层）        页头：会话名（h1）+ 会话 ID（副标题） | 操作区
modelFallback（accent 色）     提示区：warn 语义色 + 图标 + role=status
MessageList（无空态动作）      消息流（主区域，独立滚动）
InlineDialogHost               浮层区（内联对话框 / 排队消息）
MessageQueue                   输入辅助区：GPA 阶段 + 计划时间线（带边界容器）
Composer（6 个区块无分隔）     建议区 → 附件区 → 输入框（容器化焦点）→ 工具栏
```

### 逐项变更

| 审计项 | 改造前 | 改造后 |
|---|---|---|
| S1-1 | header 用 `px-4 py-3`，标题 `text-sm` 与正文同级，两个边框按钮平级 | 页头用 `px-6`，标题 `text-base font-medium` + 会话 ID 副标题；「新会话」为 secondary、「重载」为 ghost |
| S1-2 | 无 snapshot 时一句居中说明 | `EmptyState`：图标 + 「还没有打开项目」+ 说明 + 「打开项目目录」主按钮；消息区空态同样改为共用组件 |
| S1-3 | Composer 单容器堆叠 6 层内容 | GPA 阶段条与计划时间线包进 `rounded-panel` 辅助容器；建议区、附件区、输入区、工具栏各自成块；输入框外层容器承担焦点边框（`focus-within`） |
| S1-4 | 11px / 12px 混排 | 全部改为 `text-2xs` / `text-xs` 令牌档 |
| S1-5 | header `px-4`、消息区 `px-6`、Composer `p-3` 三套内边距 | 统一为 `px-6`（页头、提示区、消息区、浮层区、Composer 全部对齐） |
| S1-7 | 模型回退提示用 `bg-surface-raised text-accent` | 改为 `bg-warn-soft text-warn` + `WarningCircle` 图标 + `role="status"`（状态不靠颜色单独表达） |

### 交互与文案

- GPA 阶段标签由自造 `<span>` 改为 `Badge tone="accent"`。
- 「确认目标/确认计划」「继续执行剩余任务」由强调色实心按钮降为 `secondary` + accent 文字，使「发送」成为输入区唯一 primary（M6）。
- 去掉按钮文案前的 `✓` 装饰符（M19）。
- 「发送」「中止」改用 `Button`（primary / danger），编辑消息的「取消 / 保存并重发」改用 `Button`（secondary / primary）。
- 浮层层级改用 `--z-popover` / `--z-modal`，阴影改用 `shadow-floating` / `shadow-raised`。

### 验收

- 会话主流程未改动：输入 → 发送 → 流式输出 → 跟随滚动 → 中止，调用链与改造前一致（仅 JSX 结构与样式变化）。
- `tsc --noEmit` 0 错误；`npm run build` 成功。
- 接口未变：`MessageList({ messages })`、`Composer()`、`ChatPane()` 均无 props 变化。

---

## T8 设置页 — S6

**改动文件**：`components/SettingsPage.tsx`（重写）、`components/ui/Field.tsx`（`Switch` 支持 `id` 以关联可见标签）

### 信息架构：改造前 → 改造后

```
改造前（单列无限滚动）                  改造后（分组 + 分区）
───────────────────────────        ────────────────────────────
设置（v 版本徽章）                   页头：设置 + v 版本徽章
说明                                 ↓
外观（即时生效）          ────┐      ┌ 左侧分组导航（sticky）┬ 右侧内容区
3 个 checkbox            │      │ 外观       │ 即时生效区
[保存设置]  ← 位置随机      │      │ 行为       │ 需保存区 + 固定操作栏
项目信任（3 个平级按钮）  │      │ 项目与权限 │ 信任 + 权限规则
权限规则列表              │      │ 资源文件   │ 两个资源编辑器
提示模板 / 上下文文件（两列）┘      └───────────┴────────────────
```

### 逐项变更

| 审计项 | 改造前 | 改造后 |
|---|---|---|
| S6-1 | 五组设置纵向平铺，无分组导航 | 左侧 4 个分组导航（外观 / 行为 / 项目与权限 / 资源文件），`lg` 以上 sticky；`aria-current` 标识当前组 |
| S6-2 | 即时生效（外观）与需保存（行为）混在同一视觉层 | 拆为不同分组，并在分组说明中明写「立即生效，不需要保存」/「修改后需要保存」 |
| S6-3 | 保存按钮夹在 checkbox 之间，无 dirty 态 | `SectionCard` 的 `footer` 固定操作栏：「有未保存的更改 / 已同步」+「放弃更改」+「保存更改（primary）」；未修改时两个按钮禁用 |
| S6-4 | 信任三按钮平级，取消信任无危险语义 | 「信任此目录」primary、「信任父目录」secondary、「取消信任」danger；信任状态用 `Badge`（success/warning）表达，并随状态禁用对应按钮 |
| S6-5 | 开关只有标签 | 每项加单行说明，陈述真实约束（何时触发、影响什么、上限行为） |
| S6-6 | 输入框仅有 placeholder | 新建与编辑表单全部改为 `Field`（可见 `<label htmlFor>` + 说明），`textarea` 也带「内容」标签；创建位置改为带 `legend` 的 `fieldset` |
| S6-7 | 两列资源编辑器各自展开后高度不齐 | 改为 `xl:grid-cols-2`（窄屏单列），展开为单卡片内列表，不再出现左右互相拉扯的空白 |

### 一致性与文案

- 外观切换由自造按钮组改为 `SegmentedControl`（与侧栏导航、工作区 Tab 同源选中态）。
- 权限规则的「移除」由文字按钮改为 `IconButton`（图标 + `aria-label` 含具体规则内容）。
- 空态（无规则 / 无资源文件）使用 `EmptyState compact` 并说明下一步。
- 文案：「保存设置」→「保存更改」；保存成功提示保持陈述事实不作感叹。
- 依赖 `SectionCard` 后，分组标题不再使用最低对比度的 `text-ink-muted`（M3）。

### 行为回归声明

所有 IPC 调用与参数完全未变：`updateSettings`、`trustProject(trust, parents)`、`listPermissionRules`、`forgetPermissionRule`、`clearPermissionRules`、`getResourceFiles`、`createResourceFile`、`saveResourceFile`。仅 JSX 结构、样式与新增的 `dirty` 派生状态（纯前端）发生变化。

### 验收

- `tsc --noEmit` 0 错误；`npm run build` 成功。
- 设置项无遗漏：外观 1 项 / 行为 3 项 / 项目信任 3 动作 / 权限规则 3 动作 / 资源文件 2 组，与改造前逐项对应。

---

## T9 其余界面 — S2 / S3 / S4 / S5 / S7 / S8

**改动文件**：`SessionsPage.tsx`（重写）、`PackageCatalog.tsx`（翻新）、`PackagePage.tsx`（新增）、`ExtensionsPage.tsx` / `SkillsPage.tsx`（变薄包装）、`ModelsPage.tsx`（重写）、`FileBrowser.tsx`、`SubagentPanel.tsx`、`WorkPanel.tsx`、`DialogHost.tsx`（重写）、`Toasts.tsx`（重写）、`stores/app-store.ts`（toast 上限）

### S2 会话页

| 审计项 | 改造前 | 改造后 |
|---|---|---|
| S2-1 | 第一行 4 个同级按钮（新建/导入/导出 JSONL/导出 HTML） | 「新建会话」为唯一 primary；导入/导出集合放入带左边框的次级分组，导出为 ghost |
| S2-2 | 第二行 5 控件平铺，3 个输入框只有 placeholder | 拆为两组带 `Field`（可见标签 + 说明）的表单行：重命名 / 压缩说明；「复制分支」与压缩同组；文案「命名当前会话→重命名」「Clone→复制分支」 |
| S2-3 | 会话卡片为 `<div role="button" tabIndex>`，内嵌删除按钮 | 卡片拆为「选中按钮（`aria-pressed`）」+ 独立操作行（还原 / 删除），不再嵌套交互元素 |
| S2-4 | 还原必须双击，无键盘等价物 | 每张卡片提供显式「还原」按钮（当前会话自动禁用）；单击仍可预览会话树 |
| S2-5 | 无搜索、无排序 | 顶部搜索框（`type=search` + `aria-label`）+ 计数；当前会话置顶，其余按修改时间倒序 |
| S2-6 | 空态一句文字 | `EmptyState` + 「新建会话」CTA；有搜索词时 CTA 变为「清空搜索」 |
| S2-7 | 列表与树加载期间空白 | 分别用 `SkeletonList` 占位（列表 4 行 / 树 3 行），树错误态提供「重试」 |
| S2-8 | `lg` 断点下树区只有 140px | 断点改为 `xl`，窄屏上下堆叠且各自有独立滚动区，不再挤压 |

### S3 / S4 扩展与 Skills

| 审计项 | 改造前 | 改造后 |
|---|---|---|
| S3-1 | 两个页面约 95% 代码逐行重复 | 新增 `PackagePage.tsx`（单实现），`ExtensionsPage` / `SkillsPage` 变为 15 行以内的薄包装，仅传 `kind` 与文案；导入能力通过 `quickActions` 复用同一资源重载流程 |
| S3-2 | 「已安装」与「目录」混在同一滚动流 | 顶部 `CatalogTabs` 分段切换「已安装 N / 目录 N」，两种心智模型分离 |
| S3-3 | 加载为一行文字 | `SkeletonList` / `SkeletonCards` |
| S3-4 | 空态无 CTA | `EmptyState` + 「更新目录」primary |
| S3-5 | 页头堆长句实现细节（分页、关键字） | 页头只留用户结论，实现细节移除；目录缓存时间下沉到工具栏副标题 |
| S3-6 | 刷新无进度 | 按钮文案切为「更新中…」并禁用，空态标题同步反映拉取中 |

### S5 模型页

| 审计项 | 改造前 | 改造后 |
|---|---|---|
| S5-1 | 分组标题用 `text-ink-muted`（最低对比度）承担必读信息 | 全部改用 `Section` 组件（标题 `text-base/sm font-medium text-ink` + 说明 `text-ink-muted`）；默认模型分组自成 `Section` |
| S5-2 | 行内 5 个操作（设为默认/编辑/删除/确认删除/开关） | 开关移到行首作为独立列，并与名称 `<label htmlFor>` 关联；删除变为 `IconButton`（两段式确认保留）；操作区降为 2–3 项 |
| S5-3 | 高级 JSON 与主流程平级 | 降为页尾 `Section`，默认折叠，标题与说明明确其逃逸口定位 |
| S5-4 | 「添加服务」CTA 同时出现在标题行与空态 | 空态时只保留空态内 CTA；非空时才在标题行显示 |
| — | 本地 `Badge` 实现（border 风格）重复实现 | 改用共用 `Badge`（soft 背景 + tone），状态均伴随文字 |

### S7 工作区面板

| 审计项 | 改造前 | 改造后 |
|---|---|---|
| S7-1 | Tab 选中态为下划线，与全局选中态不一致 | 改为强调色实心胶囊（与侧栏导航/`SegmentedControl` 同源），行高 `h-7` + 容器 `p-1` |
| S7-2 | 用量面板重复展示模型名与思考等级 | 模型名移除（状态栏已有），保留思考等级与 token 明细 |
| S7-3 | 文件浏览器/子代理/用量均无共用空态 | 三处统一为 `EmptyState compact`（目录为空、加载失败可重试、无子代理、未打开项目） |
| S7-4 | Tab 用 `text-xs` 无尺寸档 | 归入 `--fs-xs` 令牌 |

### S8 浮层系统（本次部分）

| 审计项 | 改造前 | 改造后 |
|---|---|---|
| S8-1 | `DialogHost` 自建 `fixed inset-0` 容器，无尺寸档、无 Escape、无遮罩点击关闭 | 改用 `Modal` 基座：4 档宽度（select 用 `lg`）、Escape 关闭、点击遮罩关闭、`role="dialog" aria-modal`；confirm / input / secret / manual_code / select 五类的关闭语义保持不变 |
| S8-3 | Toast 无上限、无去重 | store 层去重 + `slice(-3)` 限 3 条，容器 `aria-live="polite"`，warning 色从 accent 改为 `warn` 语义色 |

### 验收

- `tsc --noEmit` 0 错误；`npm run build` 成功。
- 所有 IPC 调用与参数未变：会话页（switchSession / newSession / importJsonl / exportJsonl / exportHtml / nameSession / compact / clone / deleteSession / getTree / navigateTree / fork）、扩展与 Skills（listCatalog / listPackages / onCatalog / refreshCatalog / installPackage / removePackage / toggleResource / importSkillFile / importSkillDir）、模型页（getModelsFile / saveModelsFile / updateSettings）、对话框（respondDialog）。
- 新增文件仅 1 个：`PackagePage.tsx`（抽取重复实现的结果）。

### T9 修正记录：会话页操作条对齐

**问题**：两列表单在 `items-end` 对齐下视觉错位 —— 右列 `Field` 带 `hint`，提示文字位于列底，把右列整体顶高，导致两列输入框不在同一水平线。

**修复**：
- `Field` 不再承担说明文案；两列统一为「标签 + 输入框 + 行内按钮」同一基线，说明文字下沉到行下方的独立一行。
- 左列补一条等价说明（「重命名只改变显示名称，不影响会话内容与分支。」），使两列结构对称，同时满足 M18「说明陈述真实约束」。
- 外层 `flex flex-col gap-1 xl:justify-between`，两列等高时说明行贴底对齐。

**客观验证**（CDP 实测 `getBoundingClientRect`，1440×900）：

| 控件 | top | bottom | height |
|---|---|---|---|
| `#session-name` | 118 | 146 | 28 |
| `#session-compact-hint` | 118 | 146 | 28 |
| 「重命名」 | 118 | 146 | 28 |
| 「压缩」 | 118 | 146 | 28 |
| 「复制分支」 | 118 | 146 | 28 |

输入框 top/bottom 差值为 0，按钮底边与输入框底边齐平。修复后重跑 `ui-probe.mjs` 仍为 28/28 通过，截图已重新采集。

---

## T10 跨界面导航与层级统一

**改动文件**：`SessionsPage.tsx`、`ModelsPage.tsx`、`ModelPicker.tsx`、`models/ServicePicker.tsx`、`SkillPicker.tsx`、`models/ProviderDialog.tsx`、`ChatPane.tsx`、`SettingsPage.tsx`；新增 `docs/ui/navigation-map.md`

| 项 | 改造前 | 改造后 |
|---|---|---|
| 标题层级 | 页面 h1 `text-xl`、对话页 h1 `text-base`、区块标题 `text-sm`/`text-base` 混用；设置页 h1 直接跳到 h3 | 五档规则书面化：页面 `text-xl` / 详情型页头 `text-lg` / 页面区块 `text-base` / 卡片与工具条 `text-sm` / 模态 `text-base`；设置页面板 `SectionCard` 补 `headingLevel={2}` 消除语义跳级 |
| 选中态 | 侧栏实心、设置分组实心、工作区 tab 下划线、会话卡片描边、模型选择器纯文字 | 全部按 `navigation-map.md` 第 3 节统一：导航/分段/tab = 强调色实心；列表项选中 = `border-accent`；开关 = `accent-soft` + `accent-fill` 滑块 |
| 浮层层级 | `z-30 / z-40 / z-50` 散布 | 全部改为 `--z-popover` / `--z-modal` / `--z-toast`；`shadow-xl` → `shadow-floating`，`rounded-2xl` → `rounded-surface` |
| 确认交互 | 会话删除用 `window.confirm`，模型删除用两段式 | 统一两段式（3 秒自动复位）；全项目无 `window.confirm` / `window.alert` |
| 可达性与状态标记 | 部分按钮缺 `aria-current` / `aria-pressed` / `role` | 侧栏、设置分组 `aria-current="page"`；会话卡片 `aria-pressed`；工作区与分段控件 `role="tab"` + `aria-selected`；浮层 `role="dialog" aria-modal` |

复验命令均返回空（见 `navigation-map.md` 第 8 节）。

---

## T11 交互状态与窗口尺寸适配

**改动文件**：`stores/app-store.ts`（`bootstrapped` 标志）、`ChatPane.tsx`、`SettingsPage.tsx`、`ModelsPage.tsx`、`WorkPanel.tsx`、`StatusBar.tsx`、`Composer.tsx`、`SessionsPage.tsx`、`models/ProviderDialog.tsx`

### 状态矩阵（每界面 5 态）

| 界面 | 空态 | 加载态 | 错误态 | 禁用态 | 焦点态 |
|---|---|---|---|---|---|
| 对话 | `EmptyState`（未打开项目 / 空对话引导） | 骨架（`bootstrapped` 前，新增） | 模型回退条 `role=status` + warn 色 | 发送/中止随 `busy` 切换；编辑保存随内容/保存中 | 输入框容器 `focus-within:border-accent` |
| 会话 | `EmptyState`（无会话 / 无匹配，含 CTA） | `SkeletonList` ×2（列表与树） | `EmptyState` + 「重试」 | 「还原」在当前会话上禁用 | 全局 `:focus-visible` |
| 扩展 / Skills | `EmptyState` + 「更新目录」 | `SkeletonList` / `SkeletonCards` | toast（error，6s） | `busy` 时安装/卸载/开关禁用 | 全局 |
| 模型 | `EmptyState` + 「添加服务」 | `SkeletonList`（新增） | toast | 「设为默认」无模型时禁用 | 全局 |
| 设置 | `EmptyState compact`（规则 / 资源文件） | `SkeletonList` / `SkeletonCards`（新增） | toast | 未修改时「保存/放弃」禁用；已信任时「信任此目录」禁用 | 全局 |
| 工作区 | `EmptyState compact` ×3 | `SkeletonList`（文件树） | `EmptyState` + 重试（目录） | — | 全局 |
| 浮层 | — | 按钮文案切换（保存中… / 创建中…） | toast | `saving` 时禁用且 Escape 不关闭 | `Modal` Escape / 遮罩点击 |

### 窗口尺寸适配

| 宽度区间 | 行为 |
|---|---|
| ≥ 1180px | 侧栏 236px 展开；工作区可拖拽 260–720px（不超过 50vw） |
| 900–1180px | 侧栏自动折叠为 60px 图标栏（文字隐藏，`title` 保留名称）；主区最小 320px |
| < 900px | 状态栏隐藏 cwd，仅保留上下文 / 花费 / 模型 |
| < 1280px | 会话页列表与树上下堆叠（各自独立滚动，不再压到 140px） |
| < 1024px | 设置页分组导航取消 sticky 并转为顶部行，内容单列 |
| < 1280px | 资源目录卡片与设置资源编辑器由双列变单列 |

防溢出手段：Composer 工具栏与会话页表单行改 `flex-wrap`；工作区 `max-w-[50vw]`；主区 `min-w-[320px]`；所有长文本容器带 `truncate` + `title`。

### 动效与可访问性

- `prefers-reduced-motion: reduce`：全部时长变量缩短，仅保留颜色与透明度变化。
- `:root[data-motion="off"]`：所有动画/过渡压到 1ms，供截图与测试（对应规范 `ArcMotionLevel.Off`）。

---

## T12 会话历史加载性能 — 主进程索引 + 渐进渲染

**改动文件**：`src/main/session-index.ts`（新增）、`src/main/agent-host.ts`、`src/renderer/src/stores/app-store.ts`、`src/renderer/src/components/MessageList.tsx`、`ChatPane.tsx`、`SessionsPage.tsx`、`Composer.tsx`、`ModelPicker.tsx`、`ModelsPage.tsx`

### 问题

`SessionManager.list(cwd)` 每次调用都会把会话目录里所有 `.jsonl` 流式解析一遍（统计 `messageCount` / `firstMessage` / `modified`）。桌面端在一次会话过程中会触发十几次刷新（新会话、切模型、删除、切页），全部跑在主进程单线程上，实测 19 个会话 / 11MB 目录每次 130~300ms，直接卡住 UI 的 IPC。

### 改造

| 项 | 改造前 | 改造后 |
|---|---|---|
| 会话列表 | 每次全量重解析所有会话文件 | 按 `(mtimeMs, size)` 增量索引，只重解析刚写过的会话；命中缓存 3ms（实测 142ms → 3ms） |
| 刷新粒度 | `refreshModelsAndSessions()` 一把抓，切会话/新会话也重拉模型目录 | 拆为 `refreshSessions()` / `refreshModels()` / `refreshCommands()`，会话页只刷列表 |
| 历史会话树 | 每次点选都 `SessionManager.open()` 全量解析 | 按 `mtime/size` 缓存解析结果 |
| 消息渲染 | 一次性渲染全部历史（含长工具输出，每条都过 markdown） | 首屏只渲染最近 80 条，顶部「加载更早」逐页展开并保持视口锚点；消息 key 改用 `entryId`，展开历史时不再重挂载 |

### 验收

- `scripts/session-index.test.mjs`：4 条用例（解析字段、缓存复用、删除淘汰、目录缺失），与 `SessionManager.list` 在真实目录上逐字段比对 0 差异。
- `npm test`：44 passed；`tsc --noEmit` 两套配置 0 错误；`npm run build` 通过。
