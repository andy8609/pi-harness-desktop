import { THINKING_LEVEL_LABEL } from "@shared/types";
import { formatCost, formatElapsed } from "../lib/text";
import { useAppStore } from "../stores/app-store";

function Stat({ label, value, title }: { label: string; value: string; title: string }) {
  return (
    <span title={title} className="whitespace-nowrap">
      {label} {value}
    </span>
  );
}

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
    usage.contextPercent != null
      ? `${Math.round(usage.contextPercent)}%`
      : usage.contextWindow
        ? String(usage.contextWindow)
        : "";
  const thinking = THINKING_LEVEL_LABEL[snapshot.thinkingLevel] ?? snapshot.thinkingLevel;
  return (
    <footer className="flex h-8 items-center justify-between gap-3 border-t border-[#33392a] bg-[#1a1d16] px-3 text-xs text-[#9a937c]">
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
      <div className="flex shrink-0 items-center gap-3">
        <Stat label="输入" value={String(usage.input)} title="本会话累计发送给模型的输入 tokens" />
        <Stat label="输出" value={String(usage.output)} title="本会话模型生成的输出 tokens" />
        <Stat label="缓存读" value={String(usage.cacheRead)} title="从提示缓存读取的 tokens（命中缓存，通常更便宜）" />
        <Stat label="缓存写" value={String(usage.cacheWrite)} title="写入提示缓存的 tokens" />
        <Stat label="花费" value={formatCost(usage.cost)} title="本会话累计花费" />
        {context && (
          <Stat
            label="上下文"
            value={context}
            title={
              usage.contextPercent != null
                ? "当前上下文窗口占用比例"
                : "当前模型上下文窗口大小"
            }
          />
        )}
        <Stat label="思考" value={thinking} title={`当前思考等级：${snapshot.thinkingLevel}`} />
        <span title="当前模型" className="whitespace-nowrap">
          {snapshot.model ? `${snapshot.model.provider}/${snapshot.model.id}` : "未选择模型"}
        </span>
      </div>
    </footer>
  );
}
