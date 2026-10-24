import type { ReactNode } from "react";
import { cx } from "./cx";

export type BadgeTone = "neutral" | "accent" | "success" | "warning" | "danger" | "info";

const TONE: Record<BadgeTone, string> = {
  neutral: "bg-surface-raised text-ink-soft",
  accent: "bg-accent-soft text-accent",
  success: "bg-ok-soft text-ok",
  warning: "bg-warn-soft text-warn",
  danger: "bg-danger-soft text-danger",
  info: "bg-info-soft text-info",
};

/**
 * 状态/元数据标签。
 * 状态必须由文字表达，颜色只做辅助（规范 M13）——因此 label 不可为空。
 */
export function Badge({
  children,
  tone = "neutral",
  className,
}: {
  children: ReactNode;
  tone?: BadgeTone;
  className?: string;
}) {
  return (
    <span
      className={cx(
        "inline-flex shrink-0 items-center gap-1 rounded-pill px-1.5 py-0.5 text-2xs font-medium leading-4",
        TONE[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
