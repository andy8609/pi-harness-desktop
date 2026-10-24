import { CaretDown, Circle, CircleNotch, XCircle } from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";
import type { ChatMessage, WatchdogReport } from "@shared/types";
import { collectDelegations } from "../lib/subagent-topology";
import { formatElapsed } from "../lib/text";
import { useAppStore } from "../stores/app-store";
import { ToolCallCard } from "./ToolCallCard";
import { EmptyState } from "./ui";

function StatusDot({ status }: { status: "running" | "done" | "failed" }) {
  if (status === "running") {
    return <CircleNotch size={13} className="shrink-0 animate-spin text-accent" />;
  }
  if (status === "failed") {
    return <XCircle size={13} className="shrink-0 text-danger" />;
  }
  return <Circle size={13} className="shrink-0 text-ok" />;
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
    <div className="overflow-hidden rounded-panel border border-line bg-surface">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-surface-raised"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <CaretDown
          size={12}
          className={`shrink-0 text-ink-muted transition-transform ${open ? "" : "-rotate-90"}`}
        />
        <StatusDot status={status} />
        <span className="font-medium text-ink">
          巡查子代理{resolved ? ` · 第 ${resolved.round} 轮` : ""}
        </span>
        {resolved && (
          <span className="text-ink-muted">该操作已持续 {formatElapsed(Math.floor(resolved.elapsedMs / 1000))}</span>
        )}
        {status === "running" && <span className="text-accent">查询中</span>}
        {!open && (
          <span className="min-w-0 flex-1 truncate text-ink-muted">{preview}</span>
        )}
      </button>
      {open && (
        <pre className="whitespace-pre-wrap border-t border-line px-3 py-2 text-xs leading-5 text-ink">
          {text}
        </pre>
      )}
    </div>
  );
}

/**
 * 稳定的空数组常量。
 * zustand v5 用 useSyncExternalStore 比较 selector 结果：若每次返回新数组，
 * 会报 “getSnapshot should be cached” 并进入无限更新循环（曾导致子代理面板挂载时整页白屏）。
 */
const EMPTY_MESSAGES: ChatMessage[] = [];

export function SubagentPanel() {
  const messages = useAppStore((state) => state.snapshot?.messages ?? EMPTY_MESSAGES);
  const items = useMemo(() => collectDelegations(messages), [messages]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = items.find((item) => item.id === selectedId) ?? items[items.length - 1];

  if (items.length === 0) {
    return (
      <div className="p-2">
        <EmptyState
          compact
          title="没有检测到子代理调用"
          description="主代理连续处理超过 3 分钟时会自动开启巡查子代理，结果会出现在对话中并可收起。"
        />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="max-h-[45%] shrink-0 overflow-auto border-b border-line">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-surface-raised ${
              selected?.id === item.id ? "bg-surface-raised" : ""
            }`}
            onClick={() => setSelectedId(item.id)}
          >
            <StatusDot status={item.status} />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium text-ink">{item.name}</span>
              <span className="block truncate text-ink-muted">{item.label}</span>
            </span>
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        {selected && (
          <>
            <div className="mb-2 flex items-center gap-2 text-xs text-ink-muted">
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
