import type { ReactNode } from "react";
import { cx } from "./cx";

/**
 * 滚动型页面容器：页面头固定在上方，内容区独立滚动。
 * 水平栅格统一为 24px（px-6），与全部页面保持一致（审计项 S1-5）。
 */
export function PageShell({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx("h-full min-h-0 overflow-y-auto", className)}>
      <div className="mx-auto flex w-full max-w-[1180px] flex-col px-6 py-5">{children}</div>
    </div>
  );
}

/** 撑满型页面容器：内容区自行管理滚动（会话页等）。 */
export function PageFrame({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section className={cx("flex h-full min-h-0 flex-col", className)}>
      <div className="flex min-h-0 flex-1 flex-col px-6">{children}</div>
    </section>
  );
}

/** 页面头：标题 + 可选徽章/说明 + 右侧操作区。 */
export function PageHeader({
  title,
  description,
  badge,
  actions,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  badge?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cx("mb-5 flex shrink-0 flex-wrap items-start justify-between gap-3", className)}>
      <div className="min-w-0">
        <h1 className="flex flex-wrap items-center gap-2 text-xl font-semibold text-ink">
          {title}
          {badge}
        </h1>
        {description && <p className="mt-1 max-w-3xl text-sm text-ink-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/** 页面内的内容分区间距（垂直节奏统一为 24px）。 */
export function PageBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("flex flex-col gap-6", className)}>{children}</div>;
}
