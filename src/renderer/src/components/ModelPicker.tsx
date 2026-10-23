import { CaretDown, Check } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { THINKING_LEVEL_LABEL, orderedThinkingLevels, type ThinkingLevel } from "@shared/types";
import { refreshModelsAndSessions, useAppStore } from "../stores/app-store";

export function ModelPicker({
  placement = "down",
  compact = false,
}: {
  placement?: "up" | "down";
  compact?: boolean;
}) {
  const model = useAppStore((state) => state.snapshot?.model);
  const thinkingLevel = useAppStore((state) => state.snapshot?.thinkingLevel ?? "off");
  const availableThinkingLevels = useAppStore((state) => state.snapshot?.availableThinkingLevels);
  const models = useAppStore((state) => state.models);
  const pushToast = useAppStore((state) => state.pushToast);
  const available = models.filter((item) => item.available);
  const current = model ? `${model.provider}/${model.id}` : "";
  const currentModel = available.find((item) => `${item.provider}/${item.id}` === current);
  const levels = orderedThinkingLevels(
    currentModel?.thinkingLevels?.length
      ? currentModel.thinkingLevels
      : availableThinkingLevels?.length
        ? availableThinkingLevels
        : ["off"],
  );
  const thinkingValue = levels.includes(thinkingLevel) ? thinkingLevel : (levels[0] ?? "off");

  const modelLabel = current
    ? compact
      ? (model?.name ?? model?.id ?? "选择模型")
      : `${model?.provider}/${model?.name ?? model?.id}`
    : "选择模型";

  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <MenuSelect
        ariaLabel="选择模型"
        placement={placement}
        value={current}
        label={modelLabel}
        options={available.map((item) => ({
          value: `${item.provider}/${item.id}`,
          label: `${item.provider}/${item.name}`,
        }))}
        onChange={async (value) => {
          const [provider, ...rest] = value.split("/");
          try {
            await window.pi.setModel(provider, rest.join("/"));
            await refreshModelsAndSessions();
          } catch (error) {
            pushToast("error", error instanceof Error ? error.message : String(error));
          }
        }}
        className={compact ? "max-w-[168px]" : "max-w-[220px]"}
      />
      <MenuSelect
        ariaLabel="思考等级"
        placement={placement}
        value={thinkingValue}
        label={compact ? `思考 · ${THINKING_LEVEL_LABEL[thinkingValue] ?? thinkingValue}` : (THINKING_LEVEL_LABEL[thinkingValue] ?? thinkingValue)}
        disabled={levels.length <= 1}
        options={levels.map((level) => ({
          value: level,
          label: THINKING_LEVEL_LABEL[level] ?? level,
        }))}
        onChange={async (value) => {
          try {
            await window.pi.setThinkingLevel(value as ThinkingLevel);
          } catch (error) {
            pushToast("error", error instanceof Error ? error.message : String(error));
          }
        }}
        className={compact ? "shrink-0" : ""}
      />
    </div>
  );
}

function MenuSelect({
  value,
  label,
  options,
  onChange,
  disabled,
  className = "",
  ariaLabel,
  placement = "down",
}: {
  value: string;
  label: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void | Promise<void>;
  disabled?: boolean;
  className?: string;
  ariaLabel: string;
  placement?: "up" | "down";
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        className="flex max-w-full items-center gap-1 rounded-lg border border-[#33392a] bg-[#12140f] px-2 py-1.5 text-xs disabled:opacity-50"
        onClick={() => setOpen((current) => !current)}
      >
        <span className="min-w-0 flex-1 truncate">{label || "选择"}</span>
        <CaretDown size={11} className="shrink-0 text-[#9a937c]" />
      </button>
      {open && (
        <div
          role="listbox"
          className={`absolute right-0 z-40 max-h-72 min-w-full overflow-auto rounded-lg border border-[#33392a] bg-[#1a1d16] py-1 shadow-xl ${
            placement === "up" ? "bottom-full mb-1" : "mt-1"
          }`}
        >
          {options.length === 0 ? (
            <div className="px-3 py-1.5 text-xs text-[#9a937c]">无可选项</div>
          ) : (
            options.map((option) => {
              const selected = option.value === value;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-[#22261c] ${
                    selected ? "text-[#c4d45a]" : "text-[#ece7d5]"
                  }`}
                  onClick={() => {
                    setOpen(false);
                    if (option.value !== value) void onChange(option.value);
                  }}
                >
                  <span className="w-3 shrink-0">{selected ? <Check size={12} /> : null}</span>
                  <span className="min-w-0 flex-1 truncate">{option.label}</span>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
