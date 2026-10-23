import { useAppStore } from "../stores/app-store";

export function Toasts() {
  const toasts = useAppStore((state) => state.toasts);
  const dismissToast = useAppStore((state) => state.dismissToast);
  return (
    <div className="pointer-events-none fixed right-4 top-4 z-50 flex w-80 flex-col gap-2">
      {toasts.map((toast) => (
        <button
          key={toast.id}
          className={`pointer-events-auto rounded-xl border px-3 py-2 text-left text-sm ${
            toast.type === "error"
              ? "border-[var(--danger)] bg-[var(--danger-soft)] text-[var(--danger)]"
              : toast.type === "warning"
                ? "border-[var(--accent)] bg-[var(--bg-raised)] text-[var(--accent)]"
                : "border-[var(--line)] bg-[var(--bg-panel)] text-[var(--text)]"
          }`}
          onClick={() => dismissToast(toast.id)}
        >
          {toast.message}
        </button>
      ))}
    </div>
  );
}
