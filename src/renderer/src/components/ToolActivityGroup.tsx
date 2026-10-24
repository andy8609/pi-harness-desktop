import { CaretDown, CaretRight, Wrench } from "@phosphor-icons/react";
import { useState } from "react";
import { ToolCallCard } from "./ToolCallCard";

export interface ToolEntry {
  id: string;
  name?: string;
  args?: unknown;
  result?: unknown;
  isError?: boolean;
}

/**
 * Collapse a turn's tool calls into one activity group.
 * A single call renders inline; two or more collapse behind a summary row.
 */
export function ToolActivityGroup({ tools, running }: { tools: ToolEntry[]; running?: boolean }) {
  const [open, setOpen] = useState(false);
  if (tools.length === 0) return null;

  if (tools.length === 1) {
    const tool = tools[0];
    return (
      <ToolCallCard
        name={tool.name}
        args={tool.args}
        result={tool.result}
        isError={tool.isError}
        running={running && tool.result === undefined}
      />
    );
  }

  const pending = tools.filter((tool) => tool.result === undefined).length;
  const label = running && pending > 0 ? `正在执行 ${tools.length} 个工具调用` : `${tools.length} 个工具调用`;

  return (
    <div className="mt-2 rounded-control border border-line bg-surface-muted">
      <button
        type="button"
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-accent"
        onClick={() => setOpen((value) => !value)}
      >
        {open ? <CaretDown size={12} className="shrink-0" /> : <CaretRight size={12} className="shrink-0" />}
        {running && pending > 0 && (
          <span className="inline-block h-3 w-3 shrink-0 animate-spin rounded-full border border-accent border-t-transparent" />
        )}
        <Wrench size={13} className="shrink-0" />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {pending > 0 && <span className="shrink-0 text-ink-muted">{pending} 进行中</span>}
      </button>
      {open && (
        <div className="border-t border-line px-2 pb-2">
          {tools.map((tool) => (
            <ToolCallCard
              key={tool.id}
              name={tool.name}
              args={tool.args}
              result={tool.result}
              isError={tool.isError}
              running={running && tool.result === undefined}
            />
          ))}
        </div>
      )}
    </div>
  );
}
