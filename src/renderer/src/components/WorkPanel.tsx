import { FolderSimple, Gauge, Robot, X } from "@phosphor-icons/react";
import type { WorkPanelTab } from "@shared/types";
import { FileBrowser } from "./FileBrowser";
import { PanelResizeHandle } from "./PanelResizeHandle";
import { SubagentPanel } from "./SubagentPanel";
import { formatCost } from "../lib/text";
import { useAppStore } from "../stores/app-store";
import { EmptyState, ErrorBoundary } from "./ui";

function UsagePanel() {
  const snapshot = useAppStore((state) => state.snapshot);
  if (!snapshot) {
    return (
      <div className="p-2">
        <EmptyState compact title="尚未打开项目" description="打开项目目录后显示本会话的 token 用量与花费明细。" />
      </div>
    );
  }  const usage = snapshot.usage;
  const rows: Array<{ label: string; value: string }> = [
    { label: "输入 tokens", value: String(usage.input) },
    { label: "输出 tokens", value: String(usage.output) },
    { label: "缓存读取", value: String(usage.cacheRead) },
    { label: "缓存写入", value: String(usage.cacheWrite) },
    { label: "累计花费", value: formatCost(usage.cost) },
  ];
  if (usage.contextWindow) {
    rows.push({ label: "上下文窗口", value: String(usage.contextWindow) });
  }
  if (usage.contextPercent != null) {
    rows.push({ label: "上下文占用", value: `${Math.round(usage.contextPercent)}%` });
  }
  return (
    <div className="p-3 text-xs">
      <div className="mb-2 text-ink-muted">当前会话用量</div>
      <dl className="space-y-1.5">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between gap-3">
            <dt className="text-ink-muted">{row.label}</dt>
            <dd className="font-mono text-ink">{row.value}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-3 border-t border-line pt-3">
        <div className="mb-1 text-ink-muted">思考等级</div>
        <div className="font-mono text-ink">{snapshot.thinkingLevel}</div>
      </div>
    </div>
  );
}

const TABS: Array<{ id: WorkPanelTab; label: string; icon: typeof FolderSimple }> = [
  { id: "files", label: "文件", icon: FolderSimple },
  { id: "subagents", label: "子代理", icon: Robot },
  { id: "usage", label: "用量", icon: Gauge },
];

export function WorkPanel() {
  const workPanel = useAppStore((state) => state.workPanel);
  const setWorkPanel = useAppStore((state) => state.setWorkPanel);
  if (!workPanel.open) return null;

  return (
    <>
      <PanelResizeHandle
        width={workPanel.width}
        min={260}
        max={720}
        onResize={(width) => setWorkPanel({ width })}
      />
      <aside
        className="flex max-w-[50vw] shrink-0 flex-col border-l border-line bg-surface"
        style={{ width: workPanel.width }}
        aria-label="工作区"
      >
        <div className="flex items-center gap-1 border-b border-line p-1">
          <div role="tablist" aria-label="工作区切换" className="flex flex-1 gap-1">
            {TABS.map((tab) => {
              const Icon = tab.icon;
              const active = workPanel.tab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  className={`flex h-7 items-center gap-1.5 rounded-control px-2.5 text-xs font-medium transition-colors duration-[var(--motion-instant)] ${
                    active
                      ? "bg-accent-fill text-on-accent"
                      : "text-ink-soft hover:bg-surface-raised hover:text-ink"
                  }`}
                  onClick={() => setWorkPanel({ tab: tab.id })}
                >
                  <Icon size={13} />
                  {tab.label}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            title="收起工作区"
            aria-label="收起工作区"
            className="mr-1 rounded p-1 text-ink-muted hover:text-ink"
            onClick={() => setWorkPanel({ open: false })}
          >
            <X size={14} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">
          <ErrorBoundary label={`work:${workPanel.tab}`}>
            {workPanel.tab === "files" && <FileBrowser />}
            {workPanel.tab === "subagents" && <SubagentPanel />}
            {workPanel.tab === "usage" && <UsagePanel />}
          </ErrorBoundary>
        </div>
      </aside>
    </>
  );
}
