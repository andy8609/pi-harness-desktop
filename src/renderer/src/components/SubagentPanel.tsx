import { Circle, CircleNotch, XCircle } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import { collectDelegations } from "../lib/subagent-topology";
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
        安装支持 `Task` 类工具的 pi 扩展后，委派过程会显示在这里。
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
