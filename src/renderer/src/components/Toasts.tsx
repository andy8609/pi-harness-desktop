import { useAppStore } from "../stores/app-store";
import { cx } from "./ui";

/**
 * 轻提示：最多同时显示 3 条（上限在 store 的 pushToast 中强制），
 * 层级使用 `--z-toast`，容器声明 aria-live 以便辅助技术播报结果。
 */
export function Toasts() {
  const toasts = useAppStore((state) => state.toasts);
  const dismissToast = useAppStore((state) => state.dismissToast);

  return (
    <div
      aria-live="polite"
      aria-atomic="false"
      className="pointer-events-none fixed top-4 right-4 z-[var(--z-toast)] flex w-80 flex-col gap-2"
    >
      {toasts.map((toast) => (
        <button
          key={toast.id}
          type="button"
          title="点击关闭"
          className={cx(
            "pointer-events-auto rounded-panel border px-3 py-2 text-left text-sm shadow-floating",
            toast.type === "error"
              ? "border-danger bg-danger-soft text-danger"
              : toast.type === "warning"
                ? "border-warn bg-warn-soft text-warn"
                : "border-line bg-surface text-ink",
          )}
          onClick={() => dismissToast(toast.id)}
        >
          {toast.message}
        </button>
      ))}
    </div>
  );
}
