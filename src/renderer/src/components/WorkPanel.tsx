import { FolderSimple, Gauge, Robot, X } from "@phosphor-icons/react";
import type { WorkPanelTab } from "@shared/types";
import { FileBrowser } from "./FileBrowser";
import { PanelResizeHandle } from "./PanelResizeHandle";
import { SubagentPanel } from "./SubagentPanel";
import { formatCost } from "../lib/text";
import { useAppStore } from "../stores/app-store";

function UsagePanel() {
  const snapshot = useAppStore((state) => state.snapshot);
  if (!snapshot) {
    return <div className="px-3 py-3 text-xs text-[var(--muted)]">打开项目后显示用量。</div>;
  }
  const usage = snapshot.usage;
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
      <div className="mb-2 text-[var(--muted)]">当前会话用量</div>
      <dl className="space-y-1.5">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between gap-3">
            <dt className="text-[var(--muted)]">{row.label}</dt>
            <dd className="font-mono text-[var(--text)]">{row.value}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-3 border-t border-[var(--line)] pt-3">
        <div className="mb-1 text-[var(--muted)]">模型</div>
        <div className="truncate font-mono text-[var(--text)]">
          {snapshot.model ? `${snapshot.model.provider}/${snapshot.model.id}` : "未选择"}
        </div>
        <div className="mt-2 mb-1 text-[var(--muted)]">思考等级</div>
        <div className="font-mono text-[var(--text)]">{snapshot.thinkingLevel}</div>
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
        className="flex shrink-0 flex-col border-l border-[var(--line)] bg-[var(--bg-panel)]"
        style={{ width: workPanel.width }}
        aria-label="工作区"
      >
        <div className="flex items-center border-b border-[var(--line)]">
          <div role="tablist" aria-label="工作区切换" className="flex flex-1">
            {TABS.map((tab) => {
              const Icon = tab.icon;
              const active = workPanel.tab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  className={`flex items-center gap-1.5 px-3 py-2 text-xs ${
                    active
                      ? "border-b-2 border-[var(--accent)] text-[var(--text)]"
                      : "text-[var(--muted)] hover:text-[var(--text)]"
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
            className="mr-1 rounded p-1 text-[var(--muted)] hover:text-[var(--text)]"
            onClick={() => setWorkPanel({ open: false })}
          >
            <X size={14} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">
          {workPanel.tab === "files" && <FileBrowser />}
          {workPanel.tab === "subagents" && <SubagentPanel />}
          {workPanel.tab === "usage" && <UsagePanel />}
        </div>
      </aside>
    </>
  );
}
