import type { ReactNode } from "react";
import { cx } from "./cx";

/**
 * 表单输入的统一静态样式。
 * 供原生 input / textarea / select 复用，避免各页面自造一套边框与内边距。
 */
export const inputClass =
  "h-8 w-full rounded-control border border-line bg-canvas px-2.5 text-sm text-ink placeholder:text-ink-muted focus:border-accent focus:outline-none disabled:opacity-50";

/** 多行输入的统一样式。 */
export const textareaClass =
  "w-full resize-y rounded-control border border-line bg-canvas px-2.5 py-2 text-sm leading-5 text-ink placeholder:text-ink-muted focus:border-accent focus:outline-none disabled:opacity-50";

/**
 * 带可见标签的表单行（规范 M11）。
 * `htmlFor` 必须与内部控件 id 一致；`hint` 陈述真实约束，`error` 说明如何修复。
 */
export function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
  className,
  inline = false,
}: {
  label: ReactNode;
  htmlFor?: string;
  hint?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
  className?: string;
  inline?: boolean;
}) {
  return (
    <div className={cx(inline ? "flex items-center gap-2" : "flex flex-col gap-1", className)}>
      <label htmlFor={htmlFor} className="shrink-0 text-xs font-medium text-ink-soft">
        {label}
      </label>
      <div className={inline ? "min-w-0 flex-1" : undefined}>{children}</div>
      {error ? (
        <p className="text-2xs text-danger">{error}</p>
      ) : hint ? (
        <p className="text-2xs text-ink-muted">{hint}</p>
      ) : null}
    </div>
  );
}

/** 开关：设置项即时生效时使用。 */
export function Switch({
  checked,
  onChange,
  label,
  disabled,
  id,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
  id?: string;
}) {
  return (
    <button
      type="button"
      id={id}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        "relative h-5 w-9 shrink-0 rounded-pill border transition-colors duration-[var(--motion-fast)] disabled:opacity-50",
        checked ? "border-accent bg-accent-soft" : "border-line bg-surface-raised",
      )}
    >
      <span
        className={cx(
          "absolute top-0.5 h-3.5 w-3.5 rounded-pill transition-all duration-[var(--motion-fast)]",
          checked ? "left-[18px] bg-accent-fill" : "left-0.5 bg-ink-muted",
        )}
      />
    </button>
  );
}
