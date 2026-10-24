# 导航与层级一致性规则（T10 交付物）

本文件定义跨界面必须遵守的层级与状态规则。任何界面改动都要回到这里对照，不一致即为缺陷。

## 1. 界面跳转图

```
                        ┌──────────────── 全局外壳（常驻）────────────────┐
                        │ Sidebar（分组导航） │ main（视图容器） │ WorkPanel │
                        └─────────┬───────────────────┬──────────────┬────┘
                                  │                   │              │
   ┌──────────────────────────────┴───┐               │              │
   │ 工作区                            │               │              │
   │   对话 (chat)  ←──────────────────┼── 新建会话 / 导入 / 还原 / 节点跳转
   │   会话 (sessions) ────────────────┘               │              │
   │ 资源                                              │              │
   │   扩展 (extensions) ──┐                           │              │
   │   Skills (skills) ────┴─ 共用 PackagePage         │              │
   │   模型 (models) ──────→ ProviderDialog（模态）     │              │
   │ 工具区                                            │              │
   │   打开/收起工作区 ────→ WorkPanel.tab (files/subagents/usage)
   │   设置 (settings) ────→ 分组：外观 / 行为 / 项目与权限 / 资源文件
   └───────────────────────────────────────────────────┴──────────────┘
```

**可达性结论**：6 个 `AppView` 全部可从侧栏一步到达；设置不再与主导航平级，而是稳定停在工具区最末位。对话页可从 4 条路径进入（侧栏、新建会话、会话还原、会话树节点跳转），其余界面各只有 1 条进入路径。

## 2. 标题层级规则

| 层级 | 尺寸/字重 | 组件 | 用途 |
|---|---|---|---|
| 页面标题 | `text-xl` / semibold | `PageHeader` 的 `h1` | 会话、扩展、Skills、模型、设置 |
| 详情型页头 | `text-lg` / semibold | `ChatPane` 的 `h1` | 对话页（标题是当前会话标识，非页面名） |
| 页面内区块 | `text-base` / medium | `Section` 默认、SessionsPage「会话树」 | 模型页分区、会话树 |
| 卡片/工具条内区块 | `text-sm` / medium | `SectionCard`、`Section headingLevel={3}`、`InstalledToggleList`、`CatalogToolbar` | 设置分组、资源列表、目录工具栏 |
| 模态标题 | `text-base` / medium | `Modal` 的 `h2` | 所有对话框 |

**语义要求**：`h1` 每页有且仅有一个；`h2` 不跨级出现（页面 h1 → 区块 h2 → 卡片 h3）。设置页的面板级 `SectionCard` 使用 `headingLevel={2}`，资源编辑器使用 `headingLevel={3}`。

## 3. 选中态与状态语义

| 场景 | 样式 | 语义标记 |
|---|---|---|
| 侧栏导航当前页 | `bg-accent-fill text-on-accent` | `aria-current="page"` |
| 设置分组导航当前组 | 同上 | `aria-current="page"` |
| 分段控件选中项 | 同上 | `role="tab"` + `aria-selected` |
| 工作区 Tab 选中项 | 同上 | `role="tab"` + `aria-selected` |
| 会话卡片选中 | `border-accent`（描边，不改底色） | `aria-pressed` |
| 列表项内开关 | `border-accent bg-accent-soft` + 滑块 `bg-accent-fill` | `role="switch"` + `aria-checked` |
| 危险操作常态 | `text-danger` / `border-danger` | — |
| 危险操作悬停 | `bg-danger text-on-solid` | — |

**禁止**：下划线 tab 选中态（改造前工作区面板所用）、仅靠颜色表达选中、用 accent 表达警告。

## 4. 浮层层级

| 层 | 令牌 | 值 | 使用者 |
|---|---|---|---|
| 面板内浮层 | `--z-panel` | 10 | 预留（无当前使用者） |
| 下拉/弹出层 | `--z-popover` | 40 | ModelPicker、ServicePicker、Composer 加号菜单、模型选择器、文件右键菜单 |
| 模态 | `--z-modal` | 60 | `Modal` 基座、DialogHost、ProviderDialog、图片/文档预览 |
| 轻提示 | `--z-toast` | 80 | Toasts |

全项目已无 `z-30 / z-40 / z-50` 字面量（可用 `grep -rn "z-[345]0" src/renderer/src` 复验）。

阴影与圆角同步收敛：浮层用 `shadow-floating`，卡片用 `border-line`（无阴影），大面用 `rounded-surface`，面板 `rounded-panel`，控件 `rounded-control`。

## 5. 确认交互规则

| 破坏性动作 | 规则 | 实例 |
|---|---|---|
| 行内删除（服务、权限规则） | 两段式：图标按钮 → 「确认删除」+「取消」，3 秒无操作自动复位 | ModelsPage、SessionsPage |
| 会话删除 | 两段式（本次从 `window.confirm` 改为两段式） | SessionsPage |
| 需要用户输入或选择才能继续 | 模态 `Modal` | DialogHost（confirm / input / secret / manual_code / select） |
| 会话内归属的确认（权限、澄清） | 内联卡片，不使用遮罩 | InlineDialogHost |

全文已无 `window.confirm` / `window.alert`（可用 `grep -rn "window.confirm" src/renderer/src` 复验）。

## 6. 三态标准

| 状态 | 标准 | 组件 |
|---|---|---|
| 加载中 | 骨架占位，保留最终布局尺寸，禁止只显示一行文字 | `Skeleton` / `SkeletonList` / `SkeletonCards` |
| 空 | 标题 + 说明 + 下一步动作 | `EmptyState`（`compact` 用于面板内） |
| 错误 | 说明发生了什么 + 可重试动作 | `EmptyState` + `Button`（如会话树、目录加载失败） |

`role="status"` 或 `aria-live` 用于运行态与提示（状态栏、模型回退条、Toasts）。

## 7. M6「一个 Primary」判定口径

规范要求「每个界面只有一个 Primary 动作」，落地口径如下（避免机械判定造成可用性倒退）：

1. **页面级**：`PageHeader.actions` 中 `variant="primary"` 最多 1 个。
2. **空态互斥**：空态 CTA 与页头主操作指向同一动作时，二者同时为 primary 视为 1 个（用户任一时刻只需点击其一）。
3. **同质列表动作**：卡片网格中的「安装」（`CatalogCard`）、模态中的「保存」（`ProviderDialog`）属于同一动作的多个实例，不受限制 —— 它们是同一操作在不同数据上的重复，不构成竞争。
4. **选中态不计入**：导航、分段控件、Tab 的强调色实心是「状态」而非「动作」。
5. **禁用即降级**：主操作不可用时按钮为 disabled（保持 primary 外观），不改为其它变体。

## 8. 复验命令

```bash
# 无字面层级值
grep -rn "z-[345]0" src/renderer/src --include=*.tsx

# 无原生阻塞确认
grep -rn "window.confirm\|window.alert" src/renderer/src --include=*.tsx

# 无下划线选中 tab
grep -rn "border-b-2 border-accent" src/renderer/src --include=*.tsx

# 每个页面一个 h1
grep -rn "<h1" src/renderer/src --include=*.tsx
```

以上四条在本次交付时均返回空或仅返回 `PageShell` / `ChatPane` 两处合法 `h1`。
