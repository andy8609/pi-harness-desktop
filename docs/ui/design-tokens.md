# 设计令牌层（T4 交付物）

- 令牌源文件：`src/renderer/src/styles/tokens.css`
- 消费入口：`src/renderer/src/styles/global.css`（`@import "tailwindcss"` → `@import "./tokens.css"` → `@theme inline` 映射）
- 唯一性：全项目样式取值的唯一来源，组件内不得写字面色值/字号/圆角

## 1. 分层结构

```
tokens.css   :root（深色默认） / :root[data-theme="light"]（浅色覆盖） / prefers-reduced-motion
     ↓ var()
global.css   @theme inline  →  Tailwind 语义工具类（bg-surface / text-ink-muted / rounded-panel …）
     ↓ class
组件 tsx     className="bg-surface text-ink border border-line rounded-panel"
```

深色/浅色切换由 `lib/theme.ts` 写入 `<html data-theme>` 触发，所有 `var()` 自动重算，无需重新渲染组件。

## 2. 令牌清单

### 2.1 Surfaces

| 令牌 | 语义（对应 Arc） | 深色 | 浅色 |
|---|---|---|---|
| `--bg` | 页面底（Background） | `#12140f` | `#f7f6f1` |
| `--bg-panel` | 卡片与栏（Surface） | `#1a1d16` | `#ffffff` |
| `--bg-raised` | 抬升面（SurfaceRaised） | `#22261c` | `#f0eee6` |
| `--bg-code` | 代码与井（SurfaceMuted） | `#10130d` | `#f5f2e8` |
| `--overlay` | 遮罩（Scrim） | `rgba(0,0,0,.6)` | `rgba(20,18,10,.45)` |

Tailwind 类：`bg-canvas` / `bg-surface` / `bg-surface-raised` / `bg-surface-muted` / `bg-scrim`

### 2.2 Text（三阶）

| 令牌 | 语义（对应 Arc） | 用途约束 |
|---|---|---|
| `--text` | Foreground | 标题与正文 |
| `--text-soft` | TextSecondary | 描述、次要值 |
| `--muted` | TextMuted | **仅**提示、说明、占位，不得承载必读信息 |

Tailwind 类：`text-ink` / `text-ink-soft` / `text-ink-muted`

### 2.3 Borders

`--line`（Border）/ `--line-strong`（BorderStrong）/ `--line-subtle`（BorderSubtle，新增）
Tailwind 类：`border-line` / `border-line-strong` / `border-line-subtle`

### 2.4 Accent

| 令牌 | 语义 | 说明 |
|---|---|---|
| `--accent` | Accent | **文字用**强调色（浅色主题下为深绿，保证对比度） |
| `--accent-bg` | 强调填充 | 实心按钮/选中底色 |
| `--accent-bg-strong` | 强调填充（强） | 悬停 |
| `--accent-soft` | AccentSubtle | 选中背景浅染 |
| `--accent-line` | 强调描边 | 选中边框 |
| `--on-accent` | AccentForeground | 强调填充上的文字 |
| `--accent-strong` | AccentStrong（新增） | 浅色主题下更深的强调文字 |

Tailwind 类：`text-accent` / `bg-accent-fill` / `bg-accent-fill-strong` / `bg-accent-soft` / `border-accent` / `border-accent-line` / `text-on-accent`

> 关键区分：`text-accent`（文字）与 `bg-accent-fill`（填充）不可互换——浅色主题下二者是不同色值。

### 2.5 Status

`--danger` / `--danger-soft`、`--ok` / `--ok-soft`、`--warn` / `--warn-soft`、`--info` / `--info-soft`、`--purple` / `--purple-soft`
Tailwind 类：`text-danger` / `bg-danger-soft` / `border-danger` …

### 2.6 Focus（新增，关闭审计项 S0-7）

| 令牌 | 值 | 用途 |
|---|---|---|
| `--focus-ring` | 深色 `#c4d45a` / 浅色 `#5f7016` | 焦点环颜色 |
| `--focus-ring-width` | `2px` | 环宽 |
| `--focus-ring-offset` | `2px` | 环偏移 |

在 `global.css` 的 `@layer base` 中对 `:focus-visible` 全局应用（鼠标点击不触发）。

### 2.7 Shape

| 令牌 | 值 | 对应 Arc | 用途 |
|---|---|---|---|
| `--corner-control` | `8px` | RadiusControl | 按钮、输入框、小卡片 |
| `--corner-panel` | `12px` | RadiusPanel | 卡片、面板 |
| `--corner-surface` | `16px` | RadiusSurface | 大表面、对话框 |
| `--corner-pill` | `999px` | RadiusPill | 胶囊、徽章、开关 |

**偏差说明**：Arc 的 18/26/34 是 Avalonia 桌面控件尺度，Web 侧沿用会显得过度圆润。按规范「Avalonia 与浏览器差异做映射而非模仿」的原则，取 8/12/16。此为已记录的偏差。

### 2.8 Size

`--control-sm: 28px` / `--control-md: 32px` / `--control-lg: 36px`（控件高度档）
`--glyph-sm: 14px` / `--glyph-md: 16px` / `--glyph-lg: 20px`（图标尺寸档）

### 2.9 Spacing

4px 基准刻度：`--space-1..--space-24` = 4/8/12/16/20/24/32/40/48/64/80/96。
组件内间距直接使用 Tailwind 刻度（`p-4`=16px、`gap-2`=8px，与令牌刻度同一基准），无需另建类。

### 2.10 Type

| 令牌 | 值 | 行高 | 用途 |
|---|---|---|---|
| `--fs-2xs` | 10px | 14px | **仅**徽章、角标、计数（偏差项） |
| `--fs-xs` | 12px | 16px | 辅助信息、元数据 |
| `--fs-sm` | 14px | 20px | 正文默认 |
| `--fs-base` | 16px | 24px | 长文本正文 |
| `--fs-lg` | 18px | 26px | 区块标题 |
| `--fs-xl` | 22px | 28px | 页面标题 |
| `--fs-2xl` | 28px | 34px | 保留档 |

字体族：`--typeface-sans`（Segoe UI Variable 栈）/ `--typeface-mono`（Cascadia Code 栈）/ `--typeface-display`
字重：`--weight-regular/medium/semibold`；字距：`--tracking-display: -0.01em`

**偏差说明**：Arc 字号档从 12px 起步（XS），但本项目密集界面存在大量 10px 角标（安装数、消息数、状态徽章）。强制抬到 12px 会挤压布局，故保留 10px 作为 `2xs` 专用档并在此记录，其余档位与 Arc 对齐。

Tailwind 类：`text-2xs` / `text-xs` / `text-sm` / `text-base` / `text-lg` / `text-xl` / `text-2xl`

### 2.11 Elevation

`--elevation-resting`（卡片静止）/ `--elevation-raised`（抬升卡片与菜单）/ `--elevation-floating`（对话框与浮层）
浅色主题使用更浅的阴影（更低的 alpha），符合规范「深色模式用更深阴影」的反向映射。
Tailwind 类：`shadow-resting` / `shadow-raised` / `shadow-floating`

### 2.12 Motion（对应规范 Motion 章节）

| 令牌 | 值 | 规范对应 |
|---|---|---|
| `--motion-instant` | 120ms | DurationInstant（悬停与按压变色） |
| `--motion-fast` | 160ms | DurationFast（小淡入） |
| `--motion-exit` | 180ms | DurationExit（退场，快于入场） |
| `--motion-standard` | 240ms | DurationStandard（多数淡入与颜色过渡） |
| `--motion-considered` | 480ms | DurationConsidered（较大变化） |
| `--motion-ease-standard` | `cubic-bezier(.2,0,0,1)` | Ease… |
| `--motion-ease-out` | `cubic-bezier(.16,1,.3,1)` | 入场 |
| `--motion-ease-in` | `cubic-bezier(.4,0,1,1)` | 退场 |

Tailwind 类：`ease-standard`、`duration-*` 用任意值 `duration-[var(--motion-standard)]`

**Motion Off**：`:root[data-motion="off"]` 下所有动画与过渡压到 1ms，用于截图与测试（对应规范 `ArcMotionLevel.Off`）。
**Reduced**：`prefers-reduced-motion: reduce` 时缩短全部时长变量，保留颜色与透明度变化（对应 `ArcMotionLevel.Reduced`）。

### 2.13 Layer

`--z-panel: 10` / `--z-popover: 40` / `--z-modal: 60` / `--z-toast: 80`
用途：统一浮层叠放顺序，消除各处 `z-50` 手写值。

## 3. 落地范围与替换结果

| 项 | 替换前 | 替换后 | 结果 |
|---|---|---|---|
| 十六进制字面量 | 0 处 | 0 处 | 合规（M1） |
| 字面字号 `text-[9/10/11/12px]` | 43 处 | 0 处 | 全部改为 `text-2xs` / `text-xs` |
| 字面圆角 `rounded-[Npx]` | 0 处 | 0 处 | 合规 |
| 内置圆角刻度 `rounded-lg` / `rounded-xl` | 若干 | 0 处 | 改为 `rounded-control` / `rounded-panel` |
| 颜色任意值 `bg-[var(--…)]` / `text-[var(--…)]` | 683 处 | 0 处 | 全部改为语义工具类 |
| 焦点态 | 无 | 全局 `:focus-visible` | 合规（M15） |
| 滚动条 | 硬编码 10px 滑块 | 令牌化 + 轨道透明 + 悬停加深 | 合规（R2） |
| 动效令牌 | 无 | 3 条曲线 + 5 档时长 | 合规（M20–M24 基础） |

验证命令（均已通过）：

```bash
grep -rn "text-\[[0-9]*px\]\|rounded-\[[0-9]*px\]" src/renderer/src --include=*.tsx   # 空
grep -rn "\[var(--" src/renderer/src --include=*.tsx                                   # 空
npx tsc --noEmit -p tsconfig.web.json                                                 # 0 错误
npm run build                                                                         # 构建成功
```

产物中确认生成：`bg-surface`、`text-ink-muted`、`border-line`、`text-2xs`、`rounded-panel`、`:focus-visible`、`[data-motion="off"]`，且 `--accent-bg` 两个主题值均已内联。

## 4. 使用约定（后续任务必须遵守）

1. 颜色只写语义类：`bg-canvas` / `bg-surface` / `bg-surface-raised` / `text-ink` / `text-ink-soft` / `text-ink-muted` / `border-line` / `text-accent` / `bg-accent-fill` / `text-on-accent` / `text-danger` 等。
2. 文字强调色用 `text-accent`，实心填充用 `bg-accent-fill`，两者不得互换。
3. 字号只用 `text-2xs`～`text-2xl`，不再出现任意值字号。
4. 圆角只用 `rounded-control` / `rounded-panel` / `rounded-surface` / `rounded-pill`。
5. 需要新取值时，先加到 `tokens.css` 再消费，不得就地写字面量。
