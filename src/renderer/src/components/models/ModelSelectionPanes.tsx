import { ArrowsClockwise, CaretDown, CaretRight, MagnifyingGlass, X } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import {
  CONTEXT_WINDOW_PRESETS,
  MAX_OUTPUT_PRESETS,
  THINKING_LEVELS,
  formatTokenCount,
  matchPresetIndex,
  type UiModelBinding,
} from "./types";

export interface ModelRow {
  id: string;
  displayName: string;
  contextWindow?: number;
  maxTokens?: number;
}

/** 根据文本/图片勾选状态生成 models.json 的 input 数组；两项都取消时为空数组（明确表达无输入能力）。 */
function buildInputArray(hasText: boolean, hasImage: boolean): string[] {
  return [...(hasText ? ["text"] : []), ...(hasImage ? ["image"] : [])];
}

/**
 * Two-pane model picker, mirroring PI-Desktop's `ModelSelectionPanes`:
 * the service's discovered list on the left, the chosen configurations on the
 * right with per-model advanced controls.
 */
export function ModelSelectionPanes({
  rows,
  models,
  setModels,
  loading,
  error,
  canReload,
  onReload,
  busy,
  listTitle,
}: {
  rows: ModelRow[];
  models: UiModelBinding[];
  setModels: (update: (current: UiModelBinding[]) => UiModelBinding[]) => void;
  loading: boolean;
  error?: string;
  canReload: boolean;
  onReload?: () => void;
  busy?: boolean;
  listTitle: string;
}) {
  const [modelQuery, setModelQuery] = useState("");
  const [chosenQuery, setChosenQuery] = useState("");
  const [customId, setCustomId] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(models[0]?.id ?? null);

  const visibleRows = useMemo(() => {
    const needle = modelQuery.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter(
      (row) => row.id.toLowerCase().includes(needle) || row.displayName.toLowerCase().includes(needle),
    );
  }, [modelQuery, rows]);

  const selected = useMemo(() => new Set(models.map((model) => model.id.toLowerCase())), [models]);
  const visibleSelectedCount = useMemo(
    () => visibleRows.filter((row) => selected.has(row.id.toLowerCase())).length,
    [selected, visibleRows],
  );
  const allVisibleSelected = visibleRows.length > 0 && visibleSelectedCount === visibleRows.length;
  const someVisibleSelected = visibleSelectedCount > 0 && visibleSelectedCount < visibleRows.length;

  const visibleChosen = useMemo(() => {
    const needle = chosenQuery.trim().toLowerCase();
    if (!needle) return models;
    return models.filter(
      (model) =>
        model.id.toLowerCase().includes(needle) ||
        (model.alias ?? "").toLowerCase().includes(needle),
    );
  }, [chosenQuery, models]);

  const bindingForRow = (row: ModelRow): UiModelBinding => ({
    id: row.id,
    contextWindow: row.contextWindow,
    maxTokens: row.maxTokens,
    thinkingLevels: [],
    defaultThinkingLevel: null,
  });

  const toggleModel = (row: ModelRow) => {
    const wanted = row.id.toLowerCase();
    setModels((current) => {
      if (current.some((binding) => binding.id.toLowerCase() === wanted)) {
        return current.filter((binding) => binding.id.toLowerCase() !== wanted);
      }
      return [...current, bindingForRow(row)];
    });
    setExpandedId((open) => open ?? row.id);
  };

  const toggleVisibleModels = (select: boolean) => {
    const visibleIds = new Set(visibleRows.map((row) => row.id.toLowerCase()));
    setModels((current) => {
      if (!select) return current.filter((binding) => !visibleIds.has(binding.id.toLowerCase()));
      const chosen = new Set(current.map((binding) => binding.id.toLowerCase()));
      const additions = visibleRows
        .filter((row) => !chosen.has(row.id.toLowerCase()))
        .map(bindingForRow);
      return additions.length === 0 ? current : [...current, ...additions];
    });
  };

  const updateBinding = (id: string, patch: Partial<UiModelBinding>) =>
    setModels((current) => current.map((binding) => (binding.id === id ? { ...binding, ...patch } : binding)));

  const addCustomModel = () => {
    const id = customId.trim();
    if (!id) return;
    if (models.some((binding) => binding.id.toLowerCase() === id.toLowerCase())) {
      setCustomId("");
      return;
    }
    setModels((current) => [...current, bindingForRow({ id, displayName: id })]);
    setExpandedId(id);
    setCustomId("");
  };

  return (
    <div className="grid gap-3 md:grid-cols-2">
      <div className="flex min-h-0 flex-col rounded-xl border border-[var(--line)] bg-[var(--bg)] p-3">
        <div className="mb-2 flex items-center gap-2">
          {visibleRows.length > 0 && (
            <input
              type="checkbox"
              checked={allVisibleSelected}
              disabled={busy}
              ref={(el) => {
                if (el) el.indeterminate = someVisibleSelected;
              }}
              onChange={(event) => toggleVisibleModels(event.target.checked)}
            />
          )}
          <h4 className="min-w-0 flex-1 truncate text-xs font-medium">{listTitle}</h4>
          {onReload && (
            <button
              type="button"
              className="flex shrink-0 items-center gap-1 rounded border border-[var(--line)] px-2 py-0.5 text-[10px] disabled:opacity-50"
              disabled={busy || !canReload || loading}
              onClick={onReload}
            >
              <ArrowsClockwise size={11} className={loading ? "animate-spin" : ""} />
              {loading ? "获取中…" : "获取模型"}
            </button>
          )}
        </div>
        <div className="mb-2 flex items-center gap-2 rounded border border-[var(--line)] bg-[var(--bg-panel)] px-2 py-1">
          <MagnifyingGlass size={12} className="shrink-0 text-[var(--muted)]" />
          <input
            className="w-full bg-transparent text-xs outline-none"
            placeholder="搜索模型 ID"
            value={modelQuery}
            onChange={(event) => setModelQuery(event.target.value)}
          />
        </div>
        <div className="min-h-[180px] flex-1 overflow-auto">
          {error ? (
            <div className="px-1 py-2 text-xs text-[var(--danger)]">{error}</div>
          ) : rows.length === 0 ? (
            <div className="px-1 py-2 text-xs text-[var(--muted)]">
              {loading ? "正在获取模型…" : "该服务未返回模型，可手动添加。"}
            </div>
          ) : visibleRows.length === 0 ? (
            <div className="px-1 py-2 text-xs text-[var(--muted)]">无匹配模型</div>
          ) : (
            visibleRows.map((row) => (
              <label
                key={row.id}
                className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 hover:bg-[var(--bg-raised)]"
              >
                <input
                  type="checkbox"
                  checked={selected.has(row.id.toLowerCase())}
                  disabled={busy}
                  onChange={() => toggleModel(row)}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-mono text-xs">{row.id}</span>
                  {row.displayName && row.displayName !== row.id && (
                    <span className="block truncate text-[10px] text-[var(--muted)]">{row.displayName}</span>
                  )}
                </span>
                <span className="shrink-0 text-[10px] text-[var(--muted)]">
                  {formatTokenCount(row.contextWindow)} · {formatTokenCount(row.maxTokens)}
                </span>
              </label>
            ))
          )}
        </div>
        <div className="mt-2 flex gap-2">
          <input
            className="min-w-0 flex-1 rounded border border-[var(--line)] bg-[var(--bg-panel)] px-2 py-1 text-xs"
            placeholder="手动添加模型 ID"
            value={customId}
            onChange={(event) => setCustomId(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                addCustomModel();
              }
            }}
          />
          <button
            type="button"
            className="shrink-0 rounded border border-[var(--line)] px-2 py-1 text-xs hover:border-[var(--accent)]"
            onClick={addCustomModel}
          >
            添加
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-col rounded-xl border border-[var(--line)] bg-[var(--bg)] p-3">
        <div className="mb-2 flex items-center gap-2">
          <h4 className="text-xs font-medium">模型配置</h4>
          <span className="rounded bg-[var(--bg-raised)] px-1.5 text-[10px] text-[var(--muted)]">
            {models.length}
          </span>
          <div className="ml-auto flex items-center gap-2 rounded border border-[var(--line)] bg-[var(--bg-panel)] px-2 py-1">
            <MagnifyingGlass size={12} className="shrink-0 text-[var(--muted)]" />
            <input
              className="w-24 bg-transparent text-xs outline-none"
              placeholder="筛选已选"
              value={chosenQuery}
              disabled={models.length === 0}
              onChange={(event) => setChosenQuery(event.target.value)}
            />
          </div>
        </div>
        <div className="min-h-[180px] flex-1 space-y-2 overflow-auto">
          {models.length === 0 ? (
            <div className="px-1 py-2 text-xs text-[var(--muted)]">尚未选择模型</div>
          ) : visibleChosen.length === 0 ? (
            <div className="px-1 py-2 text-xs text-[var(--muted)]">无匹配的已选模型</div>
          ) : (
            visibleChosen.map((binding) => {
              const expanded = expandedId === binding.id;
              return (
                <div key={binding.id} className="rounded-lg border border-[var(--line)] p-2">
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate font-mono text-xs">{binding.id}</span>
                    <span className="shrink-0 text-[10px] text-[var(--muted)]">
                      {formatTokenCount(binding.contextWindow)} · {formatTokenCount(binding.maxTokens)}
                    </span>
                    <button
                      type="button"
                      className="shrink-0 text-[10px] text-[var(--accent)]"
                      title="高级设置"
                      aria-label="高级设置"
                      onClick={() => setExpandedId(expanded ? null : binding.id)}
                    >
                      {expanded ? <CaretDown size={11} /> : <CaretRight size={11} />}
                    </button>
                    <button
                      type="button"
                      title="移除"
                      aria-label="移除"
                      className="shrink-0 text-[var(--muted)] hover:text-[var(--danger)]"
                      onClick={() => setModels((current) => current.filter((entry) => entry.id !== binding.id))}
                    >
                      <X size={12} />
                    </button>
                  </div>

                  {expanded && (
                    <div className="mt-2 space-y-2 border-t border-[var(--line)] pt-2">
                      <label className="block text-[10px] text-[var(--muted)]">
                        别名
                        <input
                          className="mt-0.5 w-full rounded border border-[var(--line)] bg-[var(--bg-panel)] px-2 py-1 text-xs text-[var(--text)]"
                          value={binding.alias ?? ""}
                          placeholder="显示名称（可选）"
                          onChange={(event) =>
                            updateBinding(binding.id, {
                              alias: [...event.target.value].slice(0, 60).join(""),
                            })
                          }
                        />
                      </label>

                      {/* 模型能力：文本与图片输入对应 models.json 的 input 字段；input 未设置时 pi 默认按文本处理，故文本默认勾选 */}
                      <div className="text-[10px] text-[var(--muted)]">
                        模型能力
                        <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-1">
                          <label className="flex items-center gap-1">
                            <input
                              type="checkbox"
                              checked={binding.input?.includes("text") ?? true}
                              onChange={(event) =>
                                updateBinding(binding.id, {
                                  input: buildInputArray(
                                    event.target.checked,
                                    binding.input?.includes("image") ?? false,
                                  ),
                                })
                              }
                            />
                            文本
                          </label>
                          <label className="flex items-center gap-1">
                            <input
                              type="checkbox"
                              checked={binding.input?.includes("image") ?? false}
                              onChange={(event) =>
                                updateBinding(binding.id, {
                                  input: buildInputArray(
                                    binding.input?.includes("text") ?? true,
                                    event.target.checked,
                                  ),
                                })
                              }
                            />
                            图片输入
                          </label>
                        </div>
                      </div>

                      <div className="text-[10px] text-[var(--muted)]">
                        上下文窗口
                        <div className="mt-0.5 flex flex-wrap gap-1">
                          {CONTEXT_WINDOW_PRESETS.map((preset, index) => (
                            <button
                              key={preset.label}
                              type="button"
                              className={`rounded border px-1.5 py-0.5 text-[10px] ${
                                matchPresetIndex(CONTEXT_WINDOW_PRESETS, binding.contextWindow) === index
                                  ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--text)]"
                                  : "border-[var(--line)] hover:border-[var(--accent)]"
                              }`}
                              onClick={() =>
                                updateBinding(binding.id, { contextWindow: preset.tokens })
                              }
                            >
                              {preset.label}
                            </button>
                          ))}
                        </div>
                        <input
                          type="number"
                          min={1}
                          className="mt-1 w-full rounded border border-[var(--line)] bg-[var(--bg-panel)] px-2 py-1 text-xs text-[var(--text)]"
                          value={binding.contextWindow ?? ""}
                          onChange={(event) =>
                            updateBinding(binding.id, {
                              contextWindow: Number(event.target.value) || undefined,
                            })
                          }
                        />
                      </div>

                      <div className="text-[10px] text-[var(--muted)]">
                        最大输出
                        <div className="mt-0.5 flex flex-wrap gap-1">
                          {MAX_OUTPUT_PRESETS.map((preset, index) => (
                            <button
                              key={preset.label}
                              type="button"
                              className={`rounded border px-1.5 py-0.5 text-[10px] ${
                                matchPresetIndex(MAX_OUTPUT_PRESETS, binding.maxTokens) === index
                                  ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--text)]"
                                  : "border-[var(--line)] hover:border-[var(--accent)]"
                              }`}
                              onClick={() => updateBinding(binding.id, { maxTokens: preset.tokens })}
                            >
                              {preset.label}
                            </button>
                          ))}
                        </div>
                        <input
                          type="number"
                          min={1}
                          className="mt-1 w-full rounded border border-[var(--line)] bg-[var(--bg-panel)] px-2 py-1 text-xs text-[var(--text)]"
                          value={binding.maxTokens ?? ""}
                          onChange={(event) =>
                            updateBinding(binding.id, { maxTokens: Number(event.target.value) || undefined })
                          }
                        />
                      </div>

                      <div className="text-[10px] text-[var(--muted)]">
                        支持的思考等级
                        <div className="mt-0.5 flex flex-wrap gap-1">
                          {THINKING_LEVELS.map((level) => {
                            const on = binding.thinkingLevels.includes(level);
                            return (
                              <button
                                key={level}
                                type="button"
                                className={`rounded border px-1.5 py-0.5 text-[10px] ${
                                  on
                                    ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--text)]"
                                    : "border-[var(--line)] hover:border-[var(--accent)]"
                                }`}
                                onClick={() =>
                                  updateBinding(binding.id, {
                                    thinkingLevels: on
                                      ? binding.thinkingLevels.filter((item) => item !== level)
                                      : [...binding.thinkingLevels, level],
                                  })
                                }
                              >
                                {level}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {binding.thinkingLevels.length > 1 && (
                        <label className="block text-[10px] text-[var(--muted)]">
                          默认思考等级
                          <select
                            className="mt-0.5 w-full rounded border border-[var(--line)] bg-[var(--bg-panel)] px-2 py-1 text-xs text-[var(--text)]"
                            value={binding.defaultThinkingLevel ?? ""}
                            onChange={(event) =>
                              updateBinding(binding.id, {
                                defaultThinkingLevel: event.target.value || null,
                              })
                            }
                          >
                            <option value="">（未设置）</option>
                            {binding.thinkingLevels.map((level) => (
                              <option key={level} value={level}>
                                {level}
                              </option>
                            ))}
                          </select>
                        </label>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
