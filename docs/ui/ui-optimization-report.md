# 界面优化总报告（T13 交付物）

日期：2026-10-24　项目：`pi-desktop`（Electron + React 19 + Tailwind CSS 4）
范围：全部 9 个界面（外壳 / 对话 / 会话 / 扩展 / Skills / 模型 / 设置 / 工作区 / 浮层）
侧重：布局与信息架构（按已确认目标）

---

## 1. 一句话结论

按 `docs.tkcode.si` 的设计规范（**语义移植**，见第 2 节）建立了一套设计令牌与共用组件，并据此重排了全部界面的区域层级、导航结构与交互状态：**24 条强制条款全部落地**，构建与真实渲染进程回归 **28/28 通过**，功能调用链未改动。

## 2. 规范依据与偏差声明

参考文档描述的是 **TKCode.Arc（Avalonia + AtomUI 的 C# 控件库）**，本项目是 Web 技术栈，无法复用控件层。落地采取「语义移植、控件不移植」：

| 移植 | 不移植（已映射为等价物） |
|---|---|
| 令牌分组与语义（Surfaces / Text / Borders / Accent / Status / Focus / Shape / Size / Spacing / Type / Elevation / Motion） | `arc:` 命名空间、`ArcDesignTokenResource`、`ControlTheme`、`MotionValue<T>`、`AutomationProperties.Name` |
| 视觉规则、可访问性规则、动效规则、文案规则、逐屏评审清单 | Avalonia 专有 API |

**已记录的两处偏差**（详见 `design-tokens.md`）：

1. 圆角取 8 / 12 / 16 px（Arc 为 18 / 26 / 34），因 Avalonia 桌面尺度在 Web 上过度圆润；依据规范「Avalonia 与浏览器差异做映射而非模仿」。
2. 保留 10px 字号档（`--fs-2xs`），仅用于徽章与角标；Arc 字号从 12px 起步，但本项目密集界面强行抬到 12px 会挤压布局，故单列一档并记录。

## 3. 指标

| 指标 | 数值 |
|---|---|
| 改动文件 | 33 个已跟踪文件（+1999 / −1524 行） |
| 新增文件 | `tokens.css`、`components/ui/`（11 个）、`PackagePage.tsx`、2 个回归脚本 |
| 新增设计令牌 | 约 90 个（颜色 34 / 形状 4 / 尺寸 6 / 间距 12 / 字号 14 / 阴影 3 / 动效 8 / 层级 4 / 焦点 3） |
| 新增共用组件 | 11 个（Button、IconButton、Badge、Card、Section、SectionCard、PageShell/Frame/Header/Body、EmptyState、Skeleton×3、SegmentedControl、Field、Switch、Modal） |
| 删除的重复实现 | 扩展/Skills 页面逻辑（约 95% 重复）、3 处自造空态、2 处自造按钮组、1 处自造模态/Toast 容器、1 处本地 Badge |
| 硬编码清理 | 字面字号 43 处 → 0；颜色任意值 683 处 → 0；`z-30/40/50` 7 处 → 0；`shadow-xl` 6 处 → 0 |
| 复用代码净减 | 扩展/Skills 从 2×114 行 → 15+17 行包装 + 150 行单实现 |

## 4. 逐界面改动摘要

完整对比见 `change-log.md`（按 T6–T11 累积记录）。

| 界面 | 核心改动 | 详情 |
|---|---|---|
| 全局外壳 | 侧栏分「工作区 / 资源」两组，设置沉底；项目卡片替代裸按钮；状态栏 8 项统计 → 3 项；≤1180px 侧栏折叠为图标栏 | change-log §T6 |
| 对话页 | 页头分「标题 + 标识」与「操作」；空态给主操作；Composer 拆为辅助区/建议区/附件区/输入区/工具栏，输入框容器化焦点；模型回退提示改 warn 语义 | §T7 |
| 会话页 | 4 个平级按钮 → 主操作 + 次级分组；两组带标签表单；卡片改「选中 + 还原 + 删除」三段，两段式删除；新增搜索、当前置顶、加载/空态 | §T9 |
| 扩展 / Skills | 合并为单一实现 + 两个薄包装；「已安装 / 目录」分段切换；骨架、空态 CTA | §T9 |
| 模型页 | 分组标题不再用最低对比度色；开关移到行首并 label 关联；行内操作 5 → 2–3；高级 JSON 降级到页尾折叠 | §T9 |
| 设置页 | 左侧 4 组导航 + 右侧内容；即时生效与需保存分区；保存栏带未保存提示；信任三按钮主次/危险语义；表单全部带可见标签 | §T8 |
| 工作区面板 | Tab 选中态与全局统一；用量面板去重；三处空态统一；文件树加载/错误态 | §T9 |
| 浮层系统 | DialogHost 改用 Modal 基座（尺寸档、Escape、遮罩关闭）；Toast 限 3 条且去重；层级/阴影令牌化 | §T9、§T10 |
| 跨界面 | 标题五档规则、选中态语义、确认交互、层级令牌书面化 | `navigation-map.md` |

## 5. 改造后截图（13 张，均在 Motion Off 下采集）

目录：`docs/ui/shots/`（**已加入 `.gitignore`，不入库**；克隆后运行 `node scripts/ui-shots.mjs` 可重新生成）

| 文件 | 内容 |
|---|---|
| `01-chat-dark.png` | 对话页（深色，含消息流、Composer 分区、状态栏） |
| `02-sessions-dark.png` | 会话页（分组工具条、搜索、置顶当前会话、会话树） |
| `03-extensions-dark.png` | 扩展页（视图切换 + 已安装空态） |
| `04-skills-dark.png` | Skills 页（同上，含导入操作） |
| `05-models-dark.png` | 模型页（默认模型、服务行、高级 JSON 折叠） |
| `06-settings-appearance-dark.png` | 设置-外观（即时生效分区） |
| `07-settings-behavior-dark.png` | 设置-行为（3 开关 + 保存栏同步状态） |
| `08-settings-project-dark.png` | 设置-项目与权限（信任状态徽章 + 主次/危险按钮） |
| `09-settings-resources-dark.png` | 设置-资源文件（两组编辑器 + 空态） |
| `10-chat-workpanel-dark.png` | 对话 + 工作区面板（三 Tab） |
| `11-chat-light.png` | 对话页（浅色主题） |
| `12-settings-appearance-light.png` | 设置-外观（浅色主题） |
| `13-sessions-1000px-light.png` | 1000px 窗口：侧栏折叠 + 会话页上下堆叠 |

复现：`node scripts/ui-shots.mjs`（需先 `npx electron . --remote-debugging-port=9222`）。

## 6. 强制条款落地情况（24/24）

| 编号 | 条款 | 状态 | 证据 |
|---|---|---|---|
| M1 | 颜色全部来自令牌 | ✅ | `grep` 十六进制色值 = 0 |
| M2 | 圆角/间距/字号来自令牌 | ✅ | `text-[Npx]` / `rounded-[Npx]` = 0；`rounded-lg/xl` 全部替换为语义类 |
| M3 | 三阶文本，muted 不承载必读信息 | ✅ | 模型页/资源页分组标题改用 `text-ink`；muted 仅用于说明与元数据 |
| M4 | 强调色只用于一个主要动作 | ✅ | GPA 动作降为 secondary + accent 文字；每界面 primary ≤1 |
| M5 | 明暗双主题自检 | ✅ | 截图 06/07/11/12；暗浅两套变量 34 项对齐 |
| M6 | 一个 Primary 动作 | ✅ | 判定口径见 `navigation-map.md §7` |
| M7 | 同行控件同尺寸 | ✅ | `Button` 两档高度（28/32）；表单控件统一 `h-8` |
| M8 | 复用优先 | ✅ | 扩展/Skills 去重；三处自造空态、两处自造按钮组、一处自造模态并入共用组件 |
| M9 | 列表/表格有空态与加载态 | ✅ | 会话、扩展、Skills、模型、设置、文件树、子代理 |
| M10 | 卡片不嵌套卡片 | ✅ | 资源编辑器列表项改分隔线；嵌套面板改 `bg-surface-muted` 井 |
| M11 | 输入有可见标签 | ✅ | `Field` 强制 `label htmlFor`；新建/编辑/搜索/压缩全部带标签 |
| M12 | 图标按钮有可访问名称 | ✅ | `IconButton` 的 `label` 为必填属性 |
| M13 | 状态不靠颜色单独表达 | ✅ | `Badge` 必填文字；回退提示带图标 + `role=status` |
| M14 | 键盘可达、Tab 顺序合理 | ✅ | 全部原生 `button`/`input`；探针验证聚焦成功 |
| M15 | 焦点态可见 | ✅ | 全局 `:focus-visible` 2px + 2px offset，探针读取 `outlineWidth=2px` |
| M16 | 无装饰性全大写 | ✅ | `grep uppercase` = 0 |
| M17 | 按钮为动词 + 对象 | ✅ | 「新建会话」「重命名」「复制分支」「保存更改」「更新目录」 |
| M18 | 错误说明如何修复 | ✅ | 「目录加载失败 + 重试」「内容过长…保存会覆盖」等 |
| M19 | 确认陈述事实、无感叹号 | ✅ | 「设置已保存」「会话已重命名」；移除 `✓` 装饰符 |
| M20 | 只动画变化 | ✅ | 仅 `transition-colors` / `transition-all`（开关滑块）+ 骨架 `pulse` |
| M21 | 入场 <500ms，退场更快 | ✅ | 120 / 160 / 180 / 240 / 480ms 五档，退场 180 < 标准 240 |
| M22 | 动效非唯一状态信号 | ✅ | 所有状态均有文字/图标/颜色 |
| M23 | 金额/进度/错误不弹跳；无无限循环 | ✅ | 仅加载态使用 `animate-spin` / `animate-pulse` |
| M24 | Motion Off 下可读 | ✅ | `data-motion="off"` 全局压到 1ms；截图全程在此模式下采集 |

**强制条款落地率：24 / 24 = 100%**

## 7. 建议条款落地情况（6 完全 + 2 部分）

| 编号 | 条款 | 状态 | 说明 |
|---|---|---|---|
| R1 | 可拖拽分栏 | ✅ | `PanelResizeHandle`（已有，补齐 hover 反馈与 `role="separator"`） |
| R2 | 细滚动条 + 溢出边缘渐隐 | ⚠️ 部分 | 细滚动条 + 透明轨道 + 悬停加深已做；边缘渐隐未实现 |
| R3 | 渐进披露 | ✅ | 高级 JSON、资源文件展开、服务模型分栏 |
| R4 | 层级表达（面包屑等价物） | ✅ | 设置分组导航 + 页面标题层级表 |
| R5 | 同上下文切换用 Tabs | ✅ | 扩展/Skills 视图切换、外观分段、工作区 Tab |
| R6 | 空态给下一步动作 | ✅ | 对话（打开目录）、会话（新建/清空搜索）、扩展（浏览目录/更新）、模型（添加服务）、设置（无规则说明）、文件树（重试） |
| R7 | 骨架屏预留空间 | ✅ | `SkeletonList` / `SkeletonCards` / 局部骨架 |
| R8 | 长文本展开收起 | ⚠️ 部分 | 折叠面板类已覆盖；消息区长文本未加「展开更多」 |

## 8. 未落地项与原因

| ID | 项 | 原因 | 影响 |
|---|---|---|---|
| U1 | R2 滚动边缘渐隐 | 需要在每个滚动容器加伪元素遮罩，涉及 12 处且收益低于风险 | 低 |
| U2 | R8 消息长文本「展开更多」 | 消息渲染（`MessageList`）改动面大，且当前已有折叠的工具调用卡 | 低 |
| U3 | 选择器未抽象为统一 Popover | `ModelPicker` / `SkillPicker` / `ServicePicker` 逻辑差异大，抽象成本高于收益；**层级、阴影、圆角已统一** | 低 |
| U4 | 图片/文档预览未改用 `Modal` 基座 | 预览需要「无内边距、内容自适应」，与 `Modal` 的 header/footer 结构冲突，强行复用会引入特例分支 | 低（交互可接受） |
| U5 | 消息轮次分隔 | 属 P2 视觉增强，非信息架构问题 | 低 |

均不影响强制条款与核心流程。

## 9. 已知问题（改造前既有，未在本次范围内）

- **K1**：`src/main/agent-host.ts` 5 个 TS 类型错误（改造前存在，本次未触碰 `src/main`）。
- **K2**：`index.html` 未设置 CSP，Electron 未打包时提示安全警告。
- **K3**：渲染产物单包 1350 kB（改造前约 1323 kB）。

详见 `regression-report.md §5`。

## 10. 交付物索引

| 文件 | 内容 |
|---|---|
| `docs/ui/ui-spec-checklist.md` | 规范条款提炼（24 强制 + 8 建议 + 不适用项）+ 技术栈偏差声明 |
| `docs/ui/tech-stack-audit.md` | 技术栈、目录职责、可改动范围、现状问题 |
| `docs/ui/screen-inventory.md` | 9 个界面清单 + 43 条问题（P0 12 / P1 21 / P2 10） |
| `docs/ui/design-tokens.md` | 令牌清单、取值、Tailwind 映射、使用约定 |
| `docs/ui/layout-components.md` | 11 个共用组件的 API 与使用约定 |
| `docs/ui/navigation-map.md` | 跳转图、标题层级、选中态、浮层、确认交互、三态、M6 口径 |
| `docs/ui/change-log.md` | T6–T11 逐任务改造前后对比 |
| `docs/ui/regression-report.md` | 构建验证 + 28 项 CDP 回归 + 已知问题 |
| `docs/ui/shots/*.png` | 13 张改造后截图 |
| `scripts/ui-probe.mjs` | 可复跑的界面回归脚本（28 项断言） |
| `scripts/ui-shots.mjs` | 可复跑的截图脚本（Motion Off） |

## 11. 复验清单

```bash
# 1. 类型与构建
npx tsc --noEmit -p tsconfig.web.json     # 0 错误
npm run build                              # 成功

# 2. 字面量与一致性（均应无输出）
grep -rn "text-\[[0-9]*px\]\|rounded-\[[0-9]*px\]" src/renderer/src --include=*.tsx
grep -rn "\[var(--" src/renderer/src --include=*.tsx
grep -rn "z-[345]0" src/renderer/src --include=*.tsx
grep -rn "window.confirm\|window.alert" src/renderer/src --include=*.tsx
grep -rn "uppercase" src/renderer/src --include=*.tsx

# 3. 真实渲染进程回归（28 项）
npx electron . --remote-debugging-port=9222 &
node scripts/ui-probe.mjs

# 4. 重新采集截图
node scripts/ui-shots.mjs

# 5. 清理
powershell -NoProfile -Command "Get-Process electron | Stop-Process -Force"
```
