import type { ReactNode } from "react";
import { cx } from "./cx";

/**
 * 空态：必须给出下一步动作（规范 R6），而不是一句「暂无数据」。
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
  compact = false,
}: {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={cx(
        "flex flex-col items-center justify-center gap-2 rounded-panel border border-dashed border-line text-center",
        compact ? "px-4 py-6" : "px-6 py-12",
        className,
      )}
    >
      {icon && <div className="text-ink-muted" aria-hidden="true">{icon}</div>}
      <div className="text-sm font-medium text-ink">{title}</div>
      {description && <div className="max-w-md text-xs text-ink-muted">{description}</div>}
      {action && <div className="mt-1 flex items-center gap-2">{action}</div>}
    </div>
  );
}
