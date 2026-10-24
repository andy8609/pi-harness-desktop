import { CheckCircle, Circle, CircleNotch } from "@phosphor-icons/react";
import { useState } from "react";
import type { GpaState, PlanTask } from "@shared/gpa";

/**
 * Compact "Updated Plan" strip shown above the composer, mirroring
 * workagent's `plan-timeline.tsx`.
 */
export function PlanTimeline({ state, isRunning }: { state: GpaState; isRunning?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const items = state.planTasks;
  if (items.length === 0) return null;
  const completed = items.filter((task) => task.done).length;
  const current = items.find((task) => !task.done);
  const label = current
    ? current.title
    : isRunning
      ? `计划 ${completed}/${items.length} 已完成，正在生成完成总结`
      : `计划 ${completed}/${items.length} 已完成`;

  return (
    <section className="rounded-control border border-line bg-surface">
      <button
        type="button"
        aria-expanded={expanded}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs"
        onClick={() => setExpanded((value) => !value)}
      >
        <span className="text-accent">●</span>
        <strong className="shrink-0 text-ink">Updated Plan</strong>
        <span className="min-w-0 flex-1 truncate text-ink-muted">{label}</span>
        <span className="shrink-0 text-ink-muted">
          {completed}/{items.length}
        </span>
      </button>
      {expanded && (
        <div className="border-t border-line px-3 py-2">
          {items.map((item) => (
            <PlanRow key={item.id} item={item} currentId={current?.id} running={Boolean(isRunning)} />
          ))}
        </div>
      )}
    </section>
  );
}

function PlanRow({ item, currentId, running }: { item: PlanTask; currentId?: string; running: boolean }) {
  const active = !item.done && item.id === currentId;
  return (
    <div className="flex items-start gap-2 py-0.5 text-xs">
      {item.done ? (
        <CheckCircle size={13} className="mt-0.5 shrink-0 text-ok" />
      ) : active && running ? (
        <CircleNotch size={13} className="mt-0.5 shrink-0 animate-spin text-accent" />
      ) : (
        <Circle size={13} className="mt-0.5 shrink-0 text-ink-muted" />
      )}
      <span
        className={
          item.done
            ? "text-ink-muted line-through"
            : active
              ? "text-ink"
              : "text-ink-muted"
        }
      >
        {item.id}: {item.title}
      </span>
    </div>
  );
}
