# 界面规范可执行条款清单（T1 交付物）

- 抓取日期：2026-10-24
- 规范来源：
  - `https://docs.tkcode.si/llms.txt`（索引）
  - `https://docs.tkcode.si/docs/theming.md`（设计令牌、明暗外观、Guidelines）
  - `https://docs.tkcode.si/docs/motion.md`（动效等级、时长、Guidelines）
  - `https://docs.tkcode.si/docs/introduction.md`（Design principles）
  - `https://docs.tkcode.si/skills/tkcode-arc/checklist.md`（逐屏评审清单）

## 0. 重要偏差声明（必须先读）

抓取到的规范描述的是 **TKCode.Arc**——一套 **Avalonia 12.1.4 + AtomUI 6.2.8 的 C# 桌面控件库**（XAML 命名空间、`arc:` 前缀、`ControlTheme`、`ArcDesignTokenResource`）。

本项目 `pi-desktop` 的实际技术栈是 **Electron + React 19 + TypeScript + Tailwind CSS 4（Web 渲染层）**，不存在 Avalonia、XAML、AtomUI。

因此本次落地采取「**语义移植、控件不移植**」原则：

- **移植**：设计令牌的分组与语义（Surfaces / Text / Borders / Accent / Status / Focus / Shape / Size / Spacing / Type / Elevation / Motion）、视觉规则、可访问性规则、动效规则、文案规则、逐屏评审清单的**可判定条目**。
- **不移植**：`arc:` 命名空间、`ArcDesignTokenResource`、`ControlTheme`、`MotionValue<T>`、`AutomationProperties.Name` 等 Avalonia 专有 API。
- **等价映射**：

| 规范侧（Avalonia） | 本项目侧（React/Tailwind） |
|---|---|
| `ArcDesignTokenKind` 令牌 | `src/renderer/src/styles/tokens.css` 中的 CSS 自定义属性 |
| `{arc:ArcDesignTokenResource X}` | `var(--x)` / Tailwind 语义工具类 |
| `ArcTokens.Bind`（跟随主题变化） | CSS 变量随 `:root[data-theme]` 自动重算 |
| `ArcMotionLevel.Full/Reduced/Off` | `prefers-reduced-motion` + `data-motion` 属性 |
| `AutomationProperties.Name` | `aria-label` / `aria-labelledby` |
| `EmptyState` 控件 | 本项目 `EmptyState` 共用组件 |
| `Skeleton` / `Progress` 控件 | 骨架屏 / 进度占位共用组件 |

> 结论：规范条款中凡涉及「令牌取值、层级、一致性、可访问性、文案、动效克制」的内容 **全部按强制执行**；凡涉及具体 Avalonia 控件名与 API 的条目，**按上表映射后执行**，映射不到的直接标注为「不适用」。

---

## 1. 强制条款（Mandatory，共 24 条）

统计口径：规范中带「必须/Do/Avoid/不得」语义，且可在代码或界面上逐项判定的条目。

### 1.1 令牌与主题（M1–M5）

- [ ] **M1** 所有颜色来自令牌。视图/组件文件内不得出现十六进制色值、`rgb()`、`hsl()` 字面量（规范原文：*"A single hex value in a view is a bug in dark mode"*）。
  - 判定：`grep -rn "#[0-9a-fA-F]\{3,8\}" src/renderer/src --include=*.tsx` 结果为空。
- [ ] **M2** 圆角、间距、字号来自令牌，不用字面数字（规范：`RadiusControl`/`Space4`/`TypeSM` 等）。
  - 判定：`grep -rn "text-\[[0-9]*px\]\|rounded-\[[0-9]*px\]" src/renderer/src --include=*.tsx` 结果为空。
- [ ] **M3** 文本三阶：`--text`（标题与正文）、`--text-soft`（描述与次要值）、`--muted`（仅提示、说明、占位）。
  - 判定：`--muted` 不得出现在承载必读信息的位置（正文、列表主字段、按钮文字）。
- [ ] **M4** 强调色只用于屏幕上唯一重要的动作或状态，其余保持中性。
  - 判定：同一屏内使用 `--accent` 实心填充的可交互元素 ≤ 1 个（导航选中态与焦点环不计入）。
- [ ] **M5** 明暗两种外观 + 至少两种强调色下自检通过，每个界面都要看。

### 1.2 布局与构图（M6–M10）

- [ ] **M6** 每个界面只允许一个 Primary 动作，其余为 Secondary/Ghost，破坏性动作为 Danger。
- [ ] **M7** 同一行内的控件使用同一尺寸档（高度对齐）。
- [ ] **M8** 存在可复用组件时必须复用，不得手搓近似外观（自带 `EmptyState`/`Skeleton` 时不得自造）。
- [ ] **M9** 每个列表或表格必须有空态与加载态。
- [ ] **M10** 卡片不得嵌套卡片。

### 1.3 可访问性与状态（M11–M15）

- [ ] **M11** 每个输入控件都有可见标签（`<label>` 或 `aria-labelledby`）；仅在屏幕上已有明确命名时才允许隐藏标签。
- [ ] **M12** 每个纯图标按钮都有可访问名称（`aria-label`）。
- [ ] **M13** 状态不得仅由颜色表达；状态色必须配文字或图标。
- [ ] **M14** 所有交互元素可键盘到达，Tab 顺序符合视觉顺序。
- [ ] **M15** 焦点态可见，焦点环使用 `--focus-ring` 令牌（2px + 2px offset 语义）。

### 1.4 文案（M16–M19）

- [ ] **M16** 标签、标题、按钮不写成装饰性全大写英文（原规范：sentence case）。
- [ ] **M17** 按钮文案为「动词 + 对象」（如「保存更改」），不得只写「确定」「提交」。
- [ ] **M18** 错误信息说明如何修复；说明文案陈述真实约束。
- [ ] **M19** 确认提示陈述事实（「更改已保存」），不使用感叹号。

### 1.5 动效（M20–M24）

- [ ] **M20** 只动画「变化」：移动的移动、出现的淡入、变化的数字滚动；不做装饰性循环动画。
- [ ] **M21** 入场 < 500ms，退场快于入场（规范：`DurationExit` 180ms < `DurationStandard` 240ms）。
- [ ] **M22** 动效不得作为状态变化的唯一信号，必须配文字/图标/颜色。
- [ ] **M23** 金额、进度、错误不加弹跳；主内容区不得有无限循环动画（加载态除外，加载结束即停）。
- [ ] **M24** 每个动画变化在无动画时必须读得通（`Motion Off` 检查：终态完整、无布局跳动）。

---

## 2. 建议条款（Recommended，共 8 条）

- [ ] **R1** 用 `Resizable panels` 语义处理可拖拽分栏，分隔条提供抓取区域与光标反馈。
- [ ] **R2** 滚动容器使用细覆盖滚动条 + 仅在溢出时出现的边缘渐隐提示。
- [ ] **R3** 密集信息用 Accordion / 可展开卡片做渐进披露，而不是一次性铺满。
- [ ] **R4** 有层级关系的界面用面包屑或等价物表达「我在哪」。
- [ ] **R5** 同上下文的相关内容切换用 Tabs / Segmented control，而不是换页。
- [ ] **R6** 空态要给出下一步动作，不能只是「暂无数据」。
- [ ] **R7** 内容加载时用骨架屏预留空间，避免布局跳动。
- [ ] **R8** 长文本用「展开/收起」渐进披露，仅在文本溢出时显示该控件。

---

## 3. 不适用条款（Avalonia 专有，已声明映射）

| 规范条款 | 处置 |
|---|---|
| `arc:` 前缀、`xmlns:arc` | 不适用（Web 无 XAML 命名空间） |
| C# 命名冲突别名（`using ArcButton = ...`） | 不适用 |
| `Pinned to 0.3.0-preview.4` 包版本 | 不适用（无 NuGet 依赖） |
| `ControlTheme` / `Style` 选择器 | 映射为 React 组件与 Tailwind 语义类 |
| `MotionValue<T>` | 映射为 CSS transition / Web Animations API |
| `ThemeSwitcher` 的 Reveal/Eclipse/Split/Rise 过渡 | 映射为单次淡入（M21 约束下无必要做四种转场） |
| `InvariantGlobalization` / 构建告警 | 不适用（本项目以 `electron-vite build` 与 `tsc` 为准） |

---

## 4. 逐屏评审执行方式

每次改完一个界面，按 `1.x`/`2.x` 全部条目过一遍，未通过项当场修复后重跑，直到全通过。评审结果记录在各任务的对比说明与 `T13` 汇总报告中。
