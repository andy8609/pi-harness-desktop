import { useEffect, type ReactNode } from "react";
import { X } from "@phosphor-icons/react";
import { cx } from "./cx";
import { IconButton } from "./Button";

const SIZE: Record<"sm" | "md" | "lg" | "xl", string> = {
  sm: "max-w-sm",
  md: "max-w-lg",
  lg: "max-w-2xl",
  xl: "max-w-4xl",
};

/**
 * 统一模态基座：遮罩 + 尺寸档 + 标题 + 关闭。
 * 取代各处自建的 `fixed inset-0` 容器（审计项 S8-1）。
 */
export function Modal({
  open = true,
  title,
  description,
  size = "md",
  onClose,
  children,
  footer,
  labelledBy,
}: {
  open?: boolean;
  title: ReactNode;
  description?: ReactNode;
  size?: keyof typeof SIZE;
  onClose: () => void;
  children?: ReactNode;
  footer?: ReactNode;
  /** 无可见标题时用于 aria-labelledby，与 title 二选一即可。 */
  labelledBy?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center bg-scrim p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        className={cx("flex max-h-full w-full flex-col overflow-hidden rounded-surface border border-line bg-surface shadow-floating", SIZE[size])}
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-line-subtle px-5 py-3">
          <div className="min-w-0">
            <h2 className="text-base font-medium text-ink">{title}</h2>
            {description && <p className="mt-0.5 text-xs text-ink-muted">{description}</p>}
          </div>
          <IconButton label="关闭" size="sm" onClick={onClose}>
            <X size={14} />
          </IconButton>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex shrink-0 items-center justify-end gap-2 border-t border-line-subtle px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}
