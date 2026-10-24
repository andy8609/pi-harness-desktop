import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

const VARIANT: Record<ButtonVariant, string> = {
  primary: "border border-transparent bg-accent-fill text-on-accent hover:bg-accent-fill-strong",
  secondary: "border border-line bg-transparent text-ink hover:border-accent hover:bg-surface-raised",
  ghost: "border border-transparent bg-transparent text-ink-soft hover:bg-surface-raised hover:text-ink",
  danger: "border border-danger bg-transparent text-danger hover:bg-danger hover:text-on-solid",
};

const SIZE: Record<ButtonSize, string> = {
  sm: "h-7 gap-1.5 rounded-control px-2.5 text-xs",
  md: "h-8 gap-2 rounded-control px-3 text-sm",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
}

/**
 * 统一样式的按钮。
 * 一个界面内只应出现一个 `primary`；破坏性操作用 `danger`；工具栏与次级操作用 `ghost`。
 */
export function Button({
  variant = "secondary",
  size = "md",
  icon,
  className,
  children,
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cx(
        "inline-flex shrink-0 items-center justify-center whitespace-nowrap font-medium transition-colors duration-[var(--motion-instant)] disabled:opacity-50",
        VARIANT[variant],
        SIZE[size],
        className,
      )}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
}

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label"> {
  /** 可访问名称，必填：纯图标按钮没有可见文字。 */
  label: string;
  size?: ButtonSize;
  variant?: ButtonVariant;
}

/** 纯图标按钮：强制提供 aria-label（规范 M12）。 */
export function IconButton({ label, size = "md", variant = "ghost", className, children, type = "button", ...rest }: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cx(
        "inline-flex shrink-0 items-center justify-center transition-colors duration-[var(--motion-instant)] disabled:opacity-50",
        variant === "primary"
          ? "bg-accent-fill text-on-accent hover:bg-accent-fill-strong"
          : variant === "danger"
            ? "text-danger hover:bg-danger-soft"
            : "text-ink-muted hover:bg-surface-raised hover:text-ink",
        size === "sm" ? "h-6 w-6 rounded-control" : "h-8 w-8 rounded-control",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
