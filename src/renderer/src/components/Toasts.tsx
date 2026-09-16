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
              ? "border-[#e07a5f] bg-[#2a1612] text-[#e07a5f]"
              : toast.type === "warning"
                ? "border-[#c4d45a] bg-[#22261c] text-[#c4d45a]"
                : "border-[#33392a] bg-[#1a1d16] text-[#ece7d5]"
          }`}
          onClick={() => dismissToast(toast.id)}
        >
          {toast.message}
        </button>
      ))}
    </div>
  );
}
