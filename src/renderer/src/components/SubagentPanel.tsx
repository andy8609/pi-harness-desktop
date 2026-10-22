import { Circle, CircleNotch, XCircle } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import type { WatchdogReport } from "@shared/types";
import { collectDelegations } from "../lib/subagent-topology";
import { formatElapsed } from "../lib/text";
import { useAppStore } from "../stores/app-store";
import { ToolCallCard } from "./ToolCallCard";

function StatusDot({ status }: { status: "running" | "done" | "failed" }) {
  if (status === "running") {
    return <CircleNotch size={13} className="shrink-0 animate-spin text-[var(--accent)]" />;
  }
  if (status === "failed") {
    return <XCircle size={13} className="shrink-0 text-[var(--danger)]" />;
  }
  return <Circle size={13} className="shrink-0 text-[var(--ok)]" />;
}

/**
 * Read-only review surface for delegated work. Shows every delegation tool call
 * found in the transcript, with its arguments and bounded result.
 */
export function WatchdogFeed({ className }: { className?: string }) {
  const reports = useAppStore((state) => state.snapshot?.watchdogReports ?? []);
  if (reports.length === 0) return null;
  return (
    <div className={className ? `space-y-2 ${className}` : "space-y-2"}>
      {reports.map((report) => (
        <WatchdogCard key={report.id} report={report} />
      ))}
    </div>
  );
}

function WatchdogCard({ report }: { report: WatchdogReport }) {
  return (
    <div className="rounded-xl border border-[var(--line)] bg-[var(--bg-panel)] px-3 py-2">
      <div className="mb-1 flex items-center gap-2 text-xs">
        <StatusDot status={report.status} />
        <span className="font-medium text-[var(--text)]">巡查子代理 #{report.round}</span>
        <span className="text-[var(--muted)]">已运行 {formatElapsed(Math.floor(report.elapsedMs / 1000))}</span>
      </div>
      <pre className="whitespace-pre-wrap text-[12px] leading-5 text-[var(--text)]">{report.summary}</pre>
    </div>
  );
}

export function SubagentPanel() {
  const messages = useAppStore((state) => state.snapshot?.messages ?? []);
  const reports = useAppStore((state) => state.snapshot?.watchdogReports ?? []);
  const items = useMemo(() => collectDelegations(messages), [messages]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = items.find((item) => item.id === selectedId) ?? items[items.length - 1];

  if (items.length === 0 && reports.length === 0) {
    return (
      <div className="px-3 py-3 text-xs leading-5 text-[var(--muted)]">
        当前会话没有检测到子代理/委派调用。
        <br />
        主代理连续处理超过 3 分钟时，会自动开启巡查子代理并在这里反馈进展。
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {reports.length > 0 && (
        <div className="shrink-0 overflow-auto border-b border-[var(--line)] p-3">
          <WatchdogFeed />
        </div>
      )}
      {items.length > 0 && (
      <div className="max-h-[45%] shrink-0 overflow-auto border-b border-[var(--line)]">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-[var(--bg-raised)] ${
              selected?.id === item.id ? "bg-[var(--bg-raised)]" : ""
            }`}
            onClick={() => setSelectedId(item.id)}
          >
            <StatusDot status={item.status} />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium text-[var(--text)]">{item.name}</span>
              <span className="block truncate text-[var(--muted)]">{item.label}</span>
            </span>
          </button>
        ))}
      </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto p-3">
        {selected && (
          <>
            <div className="mb-2 flex items-center gap-2 text-xs text-[var(--muted)]">
              <StatusDot status={selected.status} />
              <span className="truncate">{selected.name}</span>
            </div>
            <ToolCallCard
              name={selected.name}
              args={selected.args}
              result={selected.result}
              isError={selected.isError}
              running={selected.status === "running"}
            />
          </>
        )}
      </div>
    </div>
  );
}
