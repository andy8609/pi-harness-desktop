import { CaretDown, Circle, CircleNotch, XCircle } from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";
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

function asWatchdogReport(value: unknown, fallbackSummary: string): WatchdogReport | undefined {
  if (!value || typeof value !== "object") return undefined;
  const item = value as Partial<WatchdogReport>;
  if (typeof item.id !== "string" || typeof item.round !== "number") return undefined;
  return {
    id: item.id,
    round: item.round,
    elapsedMs: typeof item.elapsedMs === "number" ? item.elapsedMs : 0,
    status: item.status === "failed" || item.status === "running" ? item.status : "done",
    summary: typeof item.summary === "string" ? item.summary : fallbackSummary,
    startedAt: typeof item.startedAt === "number" ? item.startedAt : Date.now(),
  };
}

/**
 * 对话流里的单轮巡查卡片：跟消息一起滚动，标题栏可收起。
 * 查询中默认展开；结束后保持用户收起/展开的选择。
 */
export function WatchdogMessage({
  report,
  details,
  summary,
}: {
  report?: WatchdogReport;
  details?: unknown;
  summary?: string;
}) {
  const resolved = report ?? asWatchdogReport(details, summary ?? "");
  const status = resolved?.status ?? "done";
  const [open, setOpen] = useState(status === "running");

  useEffect(() => {
    if (status === "running") setOpen(true);
  }, [status]);

  if (!resolved && !summary) return null;
  const text = resolved?.summary || summary || "";
  const preview = text.split("\n").find((line) => line.trim()) ?? "巡查子代理";

  return (
    <div className="overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--bg-panel)]">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-[var(--bg-raised)]"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <CaretDown
          size={12}
          className={`shrink-0 text-[var(--muted)] transition-transform ${open ? "" : "-rotate-90"}`}
        />
        <StatusDot status={status} />
        <span className="font-medium text-[var(--text)]">
          巡查子代理{resolved ? ` · 第 ${resolved.round} 轮` : ""}
        </span>
        {resolved && (
          <span className="text-[var(--muted)]">已运行 {formatElapsed(Math.floor(resolved.elapsedMs / 1000))}</span>
        )}
        {status === "running" && <span className="text-[var(--accent)]">查询中</span>}
        {!open && (
          <span className="min-w-0 flex-1 truncate text-[var(--muted)]">{preview}</span>
        )}
      </button>
      {open && (
        <pre className="whitespace-pre-wrap border-t border-[var(--line)] px-3 py-2 text-[12px] leading-5 text-[var(--text)]">
          {text}
        </pre>
      )}
    </div>
  );
}

export function SubagentPanel() {
  const messages = useAppStore((state) => state.snapshot?.messages ?? []);
  const items = useMemo(() => collectDelegations(messages), [messages]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = items.find((item) => item.id === selectedId) ?? items[items.length - 1];

  if (items.length === 0) {
    return (
      <div className="px-3 py-3 text-xs leading-5 text-[var(--muted)]">
        当前会话没有检测到子代理/委派调用。
        <br />
        主代理连续处理超过 3 分钟时，会自动开启巡查子代理，结果会出现在对话中，可收起。
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
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
