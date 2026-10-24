# 共用布局骨架与区块组件（T5 交付物）

目录：`src/renderer/src/components/ui/`　统一导出：`import { Button, PageShell, … } from "../components/ui"`

所有组件只消费 T4 令牌（语义类），无字面色值与字面字号。构建与 `tsc --noEmit` 均已通过。

## 1. 组件清单

| 组件 | 文件 | 解决的问题 | 关闭的审计项 |
|---|---|---|---|
| `PageShell` | `PageShell.tsx` | 滚动型页面容器：统一 `max-w-[1180px]` + `px-6 py-5` 栅格 | A4、S1-5 |
| `PageFrame` | `PageShell.tsx` | 撑满型页面容器（会话页），内容自管滚动 | A4 |
| `PageHeader` | `PageShell.tsx` | 标题 + 说明 + 徽章 + 右侧操作区的统一页头 | S1-1、S3-5 |
| `PageBody` | `PageShell.tsx` | 页面内分区垂直节奏（`gap-6`） | A5 |
| `Section` | `Card.tsx` | 无边框语义分组（标题 + 说明 + 操作区） | S5-1、S5-3 |
| `SectionCard` | `Card.tsx` | 带外框的独立模块（设置/配置项），含 header / body / footer 三段 | A5、S6-1 |
| `Card` | `Card.tsx` | 基础卡片容器 | A5 |
| `Button` | `Button.tsx` | 4 变体（primary / secondary / ghost / danger）× 2 尺寸 | M6、S2-1、S6-4 |
| `IconButton` | `Button.tsx` | 纯图标按钮，`label` 必填并映射 `aria-label` + `title` | M12 |
| `Badge` | `Badge.tsx` | 状态与元数据标签，6 种 tone，`children` 必填（状态必须有文字） | M13 |
| `EmptyState` | `EmptyState.tsx` | 空态：图标 + 标题 + 说明 + 下一步动作 | M9、R6、S1-2、S2-6、S3-4、S7-3 |
| `Skeleton` / `SkeletonList` / `SkeletonCards` | `Skeleton.tsx` | 加载态占位，三档：块 / 行列表 / 卡片网格 | M9、R7、S2-7、S3-3 |
| `SegmentedControl` | `SegmentedControl.tsx` | 同上下文切换，选中态统一为强调色实心 | R5、S7-1、S6-1 |
| `Field` | `Field.tsx` | 可见标签 + 提示 + 错误三段的表单行 | M11、S2-2、S6-6 |
| `Switch` | `Field.tsx` | 语义化开关（`role="switch"` + `aria-checked`） | S5-2 |
| `inputClass` / `textareaClass` | `Field.tsx` | 输入类控件的统一静态样式 | A5、S6-6 |
| `Modal` | `Modal.tsx` | 统一模态基座：遮罩 + 4 档宽度 + Escape 关闭 + 点击遮罩关闭 | S8-1 |
| `cx` | `cx.ts` | 条件类名拼接 | — |

## 2. 关键 API

```tsx
// 页面骨架
<PageShell>
  <PageHeader title="设置" description="写入 ~/.pi/settings.json" badge={<Badge>v0.1.0</Badge>}
              actions={<Button variant="primary">保存更改</Button>} />
  <PageBody>
    <Section title="外观" description="仅影响桌面界面">
      …
    </Section>
  </PageBody>
</PageShell>

// 空态
<EmptyState icon={<FolderOpen size={22} />} title="还没有打开项目"
            description="桌面端只读取 ~/.pi/agent 与官方 SDK。"
            action={<Button variant="primary">打开项目目录</Button>} />

// 模态
<Modal title="确认删除" size="sm" onClose={close}
       footer={<><Button onClick={close}>取消</Button><Button variant="danger">删除</Button></>}>
  …
</Modal>
```

## 3. 尺寸与取值的来源

| 维度 | 取值 | 令牌 |
|---|---|---|
| 控件高度 | sm 28px / md 32px | `--control-sm` / `--control-md` |
| 圆角 | 控件 8 / 面板 12 / 大面 16 / 胶囊 | `--corner-*` |
| 按钮字号 | sm 12px / md 14px | `--fs-xs` / `--fs-sm` |
| 动效 | 颜色过渡 120ms | `--motion-instant` |
| 阴影 | 浮层 | `--elevation-floating` |
| 层级 | 模态 | `--z-modal` |

## 4. 后续任务使用约定

1. **T6–T9 的页面结构只允许由本节组件拼装**，不得再新增布局语汇（否则会制造第四套模板）。
2. `PageShell` 与 `PageFrame` 二选一：需要整页滚动的用前者，需要内容区自滚（会话页）的用后者。
3. 一个界面内 `variant="primary"` 最多一个（`PageHeader.actions` 或空态 CTA 二者取其一）。
4. 列表/网格的「加载中 → 空 → 有数据」三态必须分别用 `Skeleton*` / `EmptyState` / 内容渲染。
5. 卡片内不得再放 `Card` / `SectionCard`（M10）。
6. 表单控件用 `Field` 包一层，`htmlFor` 与控件 `id` 必须对应。
