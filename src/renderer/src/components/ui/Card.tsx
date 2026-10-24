import type { ReactNode } from "react";
import { cx } from "./cx";

/** 基础卡片。规范 M10：卡片内不得再嵌卡片。 */
export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("rounded-panel border border-line bg-surface", className)}>{children}</div>;
}

/**
 * 区块标题 + 可选说明与操作区，用于页面内的语义分组。
 * 分组标题使用二级文本色，不使用最低对比度的 --muted（规范 M3）。
 */
export function Section({
  title,
  description,
  actions,
  children,
  className,
  headingLevel = 2,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  headingLevel?: 2 | 3;
}) {
  const Heading = headingLevel === 3 ? "h3" : "h2";
  return (
    <section className={cx("flex flex-col gap-3", className)}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <Heading className={headingLevel === 3 ? "text-sm font-medium text-ink" : "text-base font-medium text-ink"}>
            {title}
          </Heading>
          {description && <p className="mt-0.5 text-xs text-ink-muted">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

/** 带卡片外框的区块，用于设置/配置类页面的独立模块。 */
export function SectionCard({
  title,
  description,
  actions,
  children,
  footer,
  className,
  headingLevel = 3,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
  headingLevel?: 2 | 3;
}) {
  const Heading = headingLevel === 3 ? "h3" : "h2";
  return (
    <Card className={className}>
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-line-subtle px-4 py-3">
        <div className="min-w-0">
          <Heading className="text-sm font-medium text-ink">{title}</Heading>
          {description && <p className="mt-0.5 text-xs text-ink-muted">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      <div className="px-4 py-3">{children}</div>
      {footer && <div className="border-t border-line-subtle px-4 py-2">{footer}</div>}
    </Card>
  );
}
