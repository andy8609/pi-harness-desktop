import type { ReactNode } from "react";
import { cx } from "./cx";

export interface SegmentedOption<T extends string> {
  id: T;
  label: string;
  icon?: ReactNode;
  /** 悬停提示，用于补充说明。 */
  hint?: string;
}

/**
 * 同上下文的小集合切换（规范 R5）。
 * 选中态统一为强调色实心填充，与侧栏导航、工作区 Tab 保持一致。
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  className,
  size = "md",
}: {
  options: Array<SegmentedOption<T>>;
  value: T;
  onChange: (next: T) => void;
  ariaLabel: string;
  className?: string;
  size?: "sm" | "md";
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cx("inline-flex flex-wrap items-center gap-1 rounded-panel border border-line bg-surface-raised p-1", className)}
    >
      {options.map((option) => {
        const active = option.id === value;
        return (
          <button
            key={option.id}
            type="button"
            role="tab"
            aria-selected={active}
            title={option.hint}
            onClick={() => onChange(option.id)}
            className={cx(
              "inline-flex items-center justify-center gap-1.5 rounded-control font-medium transition-colors duration-[var(--motion-instant)]",
              size === "sm" ? "h-6 px-2 text-xs" : "h-7 px-3 text-sm",
              active
                ? "bg-accent-fill text-on-accent"
                : "text-ink-soft hover:bg-surface hover:text-ink",
            )}
          >
            {option.icon}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
