import { formatCost, formatElapsed } from "../lib/text";
import { useAppStore } from "../stores/app-store";

export function StatusBar() {
  const snapshot = useAppStore((state) => state.snapshot);
  const busy = useAppStore((state) => state.busy);
  const activity = useAppStore((state) => state.activity);
  if (!snapshot) {
    return (
      <footer className="flex h-8 items-center border-t border-[#33392a] bg-[#1a1d16] px-3 text-xs text-[#9a937c]">
        打开项目目录后开始对话。配置与会话保存在 ~/.pi/agent
      </footer>
    );
  }
  const usage = snapshot.usage;
  const context =
    usage.contextPercent != null ? `${Math.round(usage.contextPercent)}% ctx` : usage.contextWindow ? `${usage.contextWindow} ctx` : "";
  return (
    <footer className="flex h-8 items-center justify-between border-t border-[#33392a] bg-[#1a1d16] px-3 text-xs text-[#9a937c]">
      <div className="flex min-w-0 items-center gap-3">
        <span className={`flex items-center gap-1.5 ${busy ? "text-[#c4d45a]" : ""}`}>
          {busy && <span className="inline-block h-2.5 w-2.5 animate-spin rounded-full border border-current border-t-transparent" />}
          {busy ? activity?.message || "运行中" : "就绪"}
          {busy && activity?.elapsed != null && activity.elapsed >= 2000 && (
            <span className="text-[#9a937c]">{formatElapsed(Math.floor(activity.elapsed / 1000))}</span>
          )}
        </span>
        <span className="truncate">{snapshot.cwd}</span>
      </div>
      <div className="flex items-center gap-3">
        <span>
          ↑{usage.input} ↓{usage.output} R{usage.cacheRead} W{usage.cacheWrite}
        </span>
        <span>{formatCost(usage.cost)}</span>
        {context && <span>{context}</span>}
        <span>{snapshot.thinkingLevel}</span>
        <span>{snapshot.model ? `${snapshot.model.provider}/${snapshot.model.id}` : "no model"}</span>
      </div>
    </footer>
  );
}
