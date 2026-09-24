import { CheckCircle, Circle } from "@phosphor-icons/react";
import { useState } from "react";
import type { GpaState } from "@shared/gpa";

/**
 * Compact "Updated Plan" strip shown above the composer, mirroring
 * workagent's `plan-timeline.tsx`.
 */
export function PlanTimeline({ state }: { state: GpaState }) {
  const [expanded, setExpanded] = useState(false);
  const items = state.planTasks;
  if (items.length === 0) return null;
  const completed = items.filter((task) => task.done).length;
  const current = items.find((task) => !task.done);
  const label = current ? current.title : `计划 ${completed}/${items.length} 已完成`;

  return (
    <section className="mb-2 rounded-lg border border-[var(--line)] bg-[var(--bg-panel)]">
      <button
        type="button"
        aria-expanded={expanded}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs"
        onClick={() => setExpanded((value) => !value)}
      >
        <span className="text-[var(--accent)]">●</span>
        <strong className="shrink-0 text-[var(--text)]">Updated Plan</strong>
        <span className="min-w-0 flex-1 truncate text-[var(--muted)]">{label}</span>
        <span className="shrink-0 text-[var(--muted)]">
          {completed}/{items.length}
        </span>
      </button>
      {expanded && (
        <div className="border-t border-[var(--line)] px-3 py-2">
          {items.map((item) => (
            <div key={item.id} className="flex items-start gap-2 py-0.5 text-xs">
              {item.done ? (
                <CheckCircle size={13} className="mt-0.5 shrink-0 text-[var(--ok)]" />
              ) : (
                <Circle size={13} className="mt-0.5 shrink-0 text-[var(--muted)]" />
              )}
              <span className={item.done ? "text-[var(--muted)] line-through" : "text-[var(--text)]"}>
                {item.id}: {item.title}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
