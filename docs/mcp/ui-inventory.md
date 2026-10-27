# T2 当前项目 UI 与启用控件盘点

> 目标仓库：`D:/project/pi-harness-desktop`
> 目的：为「MCP 独立页面 + 导航迁移 + 列表开关统一」确定改造点与边界。

## 1. 主导航结构

`src/renderer/src/components/Sidebar.tsx`：

```ts
const NAV_GROUPS = [
  { id: "workspace", label: "工作区", items: [chat, sessions] },
  { id: "resources", label: "资源", items: [extensions, skills, models] },
];
// 底部工具区：settings
```

- `NavItem.id` 类型为 `AppView`（`src/shared/types.ts`）：`"chat" | "sessions" | "extensions" | "skills" | "models" | "settings"`。
- 目标：在 `resources` 组中 **skills 之后**插入 `{ id: "mcp", label: "MCP", icon: PlugsConnected }`，同时 `AppView` 增加 `"mcp"`。

## 2. 页面挂载与容器约定

`src/renderer/src/App.tsx`：

- 按 `view` 条件渲染：`sessions`/`extensions`/`skills`/`settings` 直接挂载；`chat`/`models` 用 `hidden` 保持常驻。
- 所有页面外层已有 `ErrorBoundary`。

容器组件（`components/ui/PageShell.tsx`）：

| 组件 | 用途 |
|---|---|
| `PageShell` | 滚动型页面：`h-full overflow-y-auto` + `max-w-[1180px] px-6 py-5` |
| `PageHeader` | 标题 + 描述 + 徽章 + 右侧操作区 |
| `PageBody` | 内容分区，`flex flex-col gap-6` |

现有 MCP 组件使用 `SectionCard`（卡片）而非页面壳，页面化时需要把「标题 + 操作区」上移到 `PageHeader`，列表留在 `PageBody`。

## 3. 设置页结构

`SettingsPage.tsx`：

```ts
type SettingsGroup = "appearance" | "behavior" | "project" | "mcp" | "resources";
const GROUPS = [
  { id: "appearance", ... },
  { id: "behavior", ... },
  { id: "project", label: "项目与权限", ... },
  { id: "mcp", label: "MCP", icon: PlugsConnected },
  { id: "resources", label: "资源文件", ... },
];
```

目标：删除 `"mcp"` 分组、`GROUPS` 中的条目、`McpSettingsPanel` 的 import 与渲染分支；`SettingsGroup` 类型同步收窄。

## 4. MCP 组件现状

| 文件 | 结构 | 页面化改造 |
|---|---|---|
| `components/mcp/McpSettingsPanel.tsx` | `SectionCard` 包裹标题/操作/列表 + `SkeletonList` + `EmptyState`；`useEffect` 拉取 `mcpList` 并订阅 `onMcpChanged` | 去掉 `SectionCard`，改为页面内的操作栏 + 列表；事件订阅保持，组件卸载时取消 |
| `components/mcp/McpServerDialog.tsx` | `Modal` 表单 | 复用，不改 |
| `components/mcp/McpToolList.tsx` | 行内展开工具清单 + `Switch` | 复用，不改 |

## 5. 启用/禁用控件全量清单

全仓检索 `type="checkbox"`、`role="switch"`、`<Switch` 结果：

| 文件:行 | 当前形态 | 语义 | 动作 |
|---|---|---|---|
| `components/PackageCatalog.tsx:113` | `<input type="checkbox">` + `<label>` 包名称 | **列表项启用**（已安装扩展 / Skills） | **改 `Switch`**，名称改为普通文本，开关 `aria-label` 保留 |
| `components/ModelsPage.tsx:290` | `Switch` | 列表项启用（自定义 provider） | 已是开关，不动 |
| `components/mcp/McpSettingsPanel.tsx:162` | `Switch` | 列表项启用（MCP 服务器） | 已是开关，不动 |
| `components/mcp/McpToolList.tsx:74` | `Switch` | 工具级启用 | 已是开关，不动 |
| `components/mcp/McpServerDialog.tsx:296` | `Switch` | 表单字段（启用服务器） | 不动 |
| `components/SettingsPage.tsx:323` | `Switch`（`SettingRow`） | 设置项开关 | 不动 |
| `components/models/ModelSelectionPanes.tsx:151` | `<input type="checkbox">` | **表单多选**（模型选择） | **保留** |
| `components/models/ModelSelectionPanes.tsx:198` | `<input type="checkbox">` | **表单多选**（服务商选择） | **保留** |
| `components/models/ModelSelectionPanes.tsx:313` | `<input type="checkbox">` | **表单能力勾选**（如 reasoning） | **保留** |
| `components/models/ModelSelectionPanes.tsx:328` | `<input type="checkbox">` | **表单能力勾选** | **保留** |

结论：需要改的只有 **1 处** `PackageCatalog.tsx:113`。但该组件被 `ExtensionsPage` 与 `SkillsPage` 共用，改动一次即覆盖两个页面（符合「扩展和 Skills 启用改滑动开关」）。

**T10 执行结果**：`InstalledResourceList` 已改为 `Switch`（文本与开关分离，开关带 `aria-label`，`busy` 时禁用）；`ModelSelectionPanes` 的 4 处表单复选框保持原样。

## 6. 扩展 / Skills 启用链路

`PackagePage.tsx`：

```ts
onToggle={(item, enabled) =>
  void run(() => window.pi.toggleResource(item, enabled), enabled ? `已启用${noun}` : `已关闭${noun}`)
}
```

- `window.pi.toggleResource(item, enabled)` → `app:toggleResource` → `host.toggleInstalledResource(item, enabled)`。
- 成功后返回完整 `PackageInventory` 并 `refreshModelsAndSessions()`。
- 失败时 `run` 的 catch 会 toast 错误，列表状态不改变（因为以服务端返回为准）。

改造后必须保持：busy 禁用、成功 toast、失败回滚（以返回值刷新列表）、`aria-label` 可读。

## 7. MCP 页面化影响面

| 关注点 | 现状 | 页面化后 |
|---|---|---|
| 数据获取 | `mcpList` + `onMcpChanged` | 不变 |
| 页面滚动 | `SettingsPage` 的 `PageBody` 内卡片 | `McpPage` 的 `PageShell` 自带滚动 |
| 操作区 | `SectionCard actions` | `PageHeader actions` |
| Tab | 无 | 新增「已安装 / 市场」`SegmentedControl` |
| 导航高亮 | `view === "settings"` | 新增 `view === "mcp"` |

## 8. 需要避免的回归

1. 移除设置分组后，`SettingsPage` 的 `SettingsGroup` 默认值与 `useState` 不受影响。
2. `McpSettingsPanel` 去掉 `SectionCard` 后，`SkeletonList`/`EmptyState` 的间距与页面节奏（`gap-6`）保持一致。
3. `PackageCatalog` 的开关不能触发整行点击（原 `<label>` 包裹导致点击名称也切换），改造后名称与开关分离。
4. 保留 `ModelSelectionPanes` 的复选框原样式，不引入 `Switch`。
