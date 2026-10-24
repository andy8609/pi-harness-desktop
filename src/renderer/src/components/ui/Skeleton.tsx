import { cx } from "./cx";

/** 骨架块：加载中占位，避免加载完成后布局跳动（规范 R7）。 */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cx("animate-pulse rounded-control bg-surface-raised", className)} />;
}

/** 列表骨架：用于会话列表、已安装列表等行式内容。 */
export function SkeletonList({ rows = 3 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-2" role="status" aria-label="正在加载">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="rounded-panel border border-line bg-surface px-4 py-3">
          <Skeleton className="h-3.5 w-2/5" />
          <Skeleton className="mt-2 h-2.5 w-1/4" />
        </div>
      ))}
    </div>
  );
}

/** 卡片网格骨架：用于目录网格。 */
export function SkeletonCards({ count = 6 }: { count?: number }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" role="status" aria-label="正在加载">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="rounded-panel border border-line bg-surface p-4">
          <Skeleton className="h-3.5 w-1/2" />
          <Skeleton className="mt-2 h-2.5 w-full" />
          <Skeleton className="mt-1.5 h-2.5 w-4/5" />
          <Skeleton className="mt-3 h-6 w-20" />
        </div>
      ))}
    </div>
  );
}
