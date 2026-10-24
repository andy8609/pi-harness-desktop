import { formatCost, formatElapsed } from "../lib/text";
import { useAppStore } from "../stores/app-store";
import { cx } from "./ui";

function Stat({ label, value, title }: { label: string; value: string; title: string }) {
  return (
    <span title={title} className="whitespace-nowrap">
      <span className="text-ink-muted">{label} </span>
      <span className="text-ink-soft">{value}</span>
    </span>
  );
}

/**
 * 状态栏：只保留全局常看的三类信息 —— 运行态、工作目录、会话成本概况。
 *
 * 改造前右侧常显 8 项统计（输入/输出/缓存读/缓存写/花费/上下文/思考/模型），
 * 与工作区「用量」面板重复且在窄窗口下挤压关键值（审计 S0-6）。
 * 现在：token 明细与思考等级归口工作区「用量」，状态栏只留上下文占用、花费与当前模型。
 */
export function StatusBar() {
  const snapshot = useAppStore((state) => state.snapshot);
  const busy = useAppStore((state) => state.busy);
  const activity = useAppStore((state) => state.activity);

  if (!snapshot) {
    return (
      <footer
        aria-label="状态栏"
        className="flex h-8 shrink-0 items-center border-t border-line bg-surface px-3 text-xs text-ink-muted"
      >
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

  return (
    <footer
      aria-label="状态栏"
      className="flex h-8 shrink-0 items-center justify-between gap-3 border-t border-line bg-surface px-3 text-xs"
    >
      <div className="flex min-w-0 items-center gap-3">
        <span
          aria-live="polite"
          className={cx("flex shrink-0 items-center gap-1.5", busy ? "text-accent" : "text-ink-muted")}
        >
          {busy && (
            <span
              aria-hidden="true"
              className="inline-block h-2.5 w-2.5 animate-spin rounded-pill border border-current border-t-transparent"
            />
          )}
          {busy ? activity?.message || "运行中" : "就绪"}
          {busy && activity?.elapsed != null && activity.elapsed >= 2000 && (
            <span className="text-ink-muted">{formatElapsed(Math.floor(activity.elapsed / 1000))}</span>
          )}
        </span>
        <span className="truncate text-ink-muted max-[900px]:hidden" title={snapshot.cwd}>
          {snapshot.cwd}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        {context && (
          <Stat
            label="上下文"
            value={context}
            title={usage.contextPercent != null ? "当前上下文窗口占用比例" : "当前模型上下文窗口大小"}
          />
        )}
        <Stat label="花费" value={formatCost(usage.cost)} title="本会话累计花费；token 明细见工作区「用量」" />
        <span title="当前模型" className="max-w-[220px] truncate text-ink-soft">
          {snapshot.model ? `${snapshot.model.provider}/${snapshot.model.id}` : "未选择模型"}
        </span>
      </div>
    </footer>
  );
}
