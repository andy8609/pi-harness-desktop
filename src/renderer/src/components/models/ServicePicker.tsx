import { CaretDown, Check, MagnifyingGlass } from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { CUSTOM_SERVICE, SERVICE_PRESETS } from "./types";

interface Option {
  id: string;
  label: string;
  haystack: string;
}

/** Searchable service menu, mirroring PI-Desktop's `ServicePicker`. */
export function ServicePicker({
  value,
  disabled,
  onChange,
}: {
  value: string;
  disabled?: boolean;
  onChange: (next: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  const options = useMemo<Option[]>(() => {
    const custom: Option = {
      id: CUSTOM_SERVICE,
      label: "自定义 / 兼容接口",
      haystack: "自定义 custom endpoint 兼容",
    };
    const named = SERVICE_PRESETS.map((preset) => ({
      id: preset.id,
      label: preset.label,
      haystack: `${preset.label} ${preset.name} ${preset.id} ${preset.baseUrl}`.toLowerCase(),
    }));
    return [custom, ...named];
  }, []);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return options;
    return options.filter((option) => option.haystack.includes(needle));
  }, [options, query]);

  const selected = options.find((option) => option.id === value);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 rounded border border-[var(--line)] bg-[var(--bg)] px-2 py-1 text-left text-sm disabled:opacity-50"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => {
          if (disabled) return;
          setQuery("");
          setOpen((current) => !current);
        }}
      >
        <span className="min-w-0 truncate">{selected?.label ?? "选择服务"}</span>
        <CaretDown size={14} className="shrink-0" />
      </button>
      {open && (
        <div className="absolute z-30 mt-1 w-full rounded-lg border border-[var(--line)] bg-[var(--bg-panel)] p-2 shadow-xl">
          <div className="mb-2 flex items-center gap-2 rounded border border-[var(--line)] bg-[var(--bg)] px-2 py-1">
            <MagnifyingGlass size={13} className="shrink-0 text-[var(--muted)]" />
            <input
              autoFocus
              className="w-full bg-transparent text-xs outline-none"
              placeholder="搜索服务"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <div className="max-h-56 overflow-auto">
            {visible.length === 0 ? (
              <div className="px-2 py-1 text-xs text-[var(--muted)]">无匹配服务</div>
            ) : (
              visible.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  role="option"
                  aria-selected={option.id === value}
                  className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs hover:bg-[var(--bg-raised)]"
                  onClick={() => {
                    onChange(option.id);
                    setOpen(false);
                  }}
                >
                  <span className="w-3 shrink-0">
                    {option.id === value ? <Check size={12} className="text-[var(--accent)]" /> : null}
                  </span>
                  <span className="truncate">{option.label}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
