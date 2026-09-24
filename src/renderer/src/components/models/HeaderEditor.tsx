import { Plus, Trash } from "@phosphor-icons/react";

export interface HeaderPair {
  key: string;
  value: string;
}

export function recordToPairs(record?: Record<string, string>): HeaderPair[] {
  return Object.entries(record ?? {}).map(([key, value]) => ({ key, value }));
}

export function pairsToRecord(pairs: HeaderPair[]): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  for (const pair of pairs) {
    const key = pair.key.trim();
    if (key) out[key] = pair.value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Editable key/value list for per-provider request headers. */
export function HeaderEditor({
  pairs,
  onChange,
}: {
  pairs: HeaderPair[];
  onChange: (next: HeaderPair[]) => void;
}) {
  return (
    <div>
      <div className="mb-2 text-xs text-[var(--muted)]">自定义请求头（可选）</div>
      <div className="space-y-2">
        {pairs.map((pair, index) => (
          <div key={index} className="flex gap-2">
            <input
              className="w-1/3 rounded border border-[var(--line)] bg-[var(--bg)] px-2 py-1 text-xs outline-none focus:border-[var(--accent)]"
              placeholder="Header 名称"
              value={pair.key}
              onChange={(event) => {
                const next = [...pairs];
                next[index] = { ...pair, key: event.target.value };
                onChange(next);
              }}
            />
            <input
              className="min-w-0 flex-1 rounded border border-[var(--line)] bg-[var(--bg)] px-2 py-1 text-xs outline-none focus:border-[var(--accent)]"
              placeholder="值"
              value={pair.value}
              onChange={(event) => {
                const next = [...pairs];
                next[index] = { ...pair, value: event.target.value };
                onChange(next);
              }}
            />
            <button
              type="button"
              title="删除"
              aria-label="删除"
              className="shrink-0 rounded border border-[var(--line)] px-2 text-[var(--muted)] hover:border-[var(--danger)] hover:text-[var(--danger)]"
              onClick={() => onChange(pairs.filter((_, i) => i !== index))}
            >
              <Trash size={13} />
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        className="mt-2 flex items-center gap-1 rounded border border-[var(--line)] px-2 py-1 text-xs hover:border-[var(--accent)]"
        onClick={() => onChange([...pairs, { key: "", value: "" }])}
      >
        <Plus size={12} />
        添加请求头
      </button>
    </div>
  );
}
