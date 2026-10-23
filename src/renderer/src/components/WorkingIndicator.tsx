import { useEffect, useState } from "react";
import { formatElapsed } from "../lib/text";
import { useAppStore } from "../stores/app-store";

export function WorkingIndicator() {
  const busy = useAppStore((state) => state.busy);
  const activity = useAppStore((state) => state.activity);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!busy) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [busy]);

  if (!busy) return null;

  const startedAt = activity?.startedAt ?? now;
  const elapsed = Math.max(0, Math.floor((now - startedAt) / 1000));
  const label = activity?.message || "会话仍在进行";

  return (
    <div className="mt-3 flex items-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--bg-panel)] px-3 py-2 text-sm text-[var(--accent)]">
      <span className="inline-block h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-[var(--accent)] border-t-transparent" />
      <span className="min-w-0 flex-1">{label}</span>
      {elapsed >= 2 && <span className="shrink-0 text-xs text-[var(--muted)]">已等待 {formatElapsed(elapsed)}</span>}
    </div>
  );
}
