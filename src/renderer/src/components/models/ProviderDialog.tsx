import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { CustomProviderConfig, ModelDevDefaults } from "@shared/types";
import { defaultsKey, loadModelDefaults } from "../../lib/models-dev";
import { listRemoteModels, type RemoteModel } from "../../lib/remote-models";
import { useAppStore } from "../../stores/app-store";
import { HeaderEditor, pairsToRecord, recordToPairs, type HeaderPair } from "./HeaderEditor";
import { ModelSelectionPanes, type ModelRow } from "./ModelSelectionPanes";
import { ServicePicker } from "./ServicePicker";
import {
  API_STYLES,
  CUSTOM_SERVICE,
  SERVICE_PRESETS,
  configFromProvider,
  serviceForProvider,
  type UiModelBinding,
  type UiProvider,
} from "./types";

/**
 * Add / edit an AI service, mirroring PI-Desktop's `ProviderSetupDialog`:
 * a searchable service menu, the common credential path, an advanced header
 * editor, and the two-pane model picker.
 */
export function ProviderDialog({
  editingId,
  initial,
  onClose,
  onSave,
}: {
  editingId: string | null;
  initial?: CustomProviderConfig;
  onClose: () => void;
  onSave: (id: string, config: CustomProviderConfig) => Promise<void>;
}) {
  const pushToast = useAppStore((state) => state.pushToast);
  const initialUi = useMemo<UiProvider | null>(
    () =>
      editingId
        ? {
            id: editingId,
            name: initial?.name ?? editingId,
            baseUrl: initial?.baseUrl ?? "",
            api: initial?.api ?? "openai-completions",
            apiKey: initial?.apiKey,
            headers: initial?.headers,
            enabled: initial?.enabled !== false,
            models: (initial?.models ?? []).map((model) => ({
              id: model.id,
              alias: model.name,
              contextWindow: model.contextWindow,
              maxTokens: model.maxTokens,
              reasoning: model.reasoning,
              input: model.input,
              thinkingLevels: model.thinkingLevels ?? [],
              defaultThinkingLevel: model.defaultThinkingLevel ?? null,
            })),
          }
        : null,
    [editingId, initial],
  );

  const [service, setService] = useState(() => (initialUi ? serviceForProvider(initialUi) : "openai"));
  const [providerId, setProviderId] = useState(editingId ?? "");
  const [name, setName] = useState(initialUi?.name ?? "");
  const [baseUrl, setBaseUrl] = useState(initialUi?.baseUrl ?? SERVICE_PRESETS[0].baseUrl);
  const [apiKey, setApiKey] = useState("");
  const [api, setApi] = useState(initialUi?.api ?? SERVICE_PRESETS[0].api);
  const [pairs, setPairs] = useState<HeaderPair[]>(recordToPairs(initial?.headers));
  const [models, setModels] = useState<UiModelBinding[]>(initialUi?.models ?? []);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [remote, setRemote] = useState<RemoteModel[]>([]);
  const [loading, setLoading] = useState(false);
  const [defaults, setDefaults] = useState<Record<string, ModelDevDefaults>>({});
  const [defaultsLoading, setDefaultsLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);

  const preset = SERVICE_PRESETS.find((item) => item.id === service);
  const named = Boolean(preset);
  const custom = service === CUSTOM_SERVICE;
  const resolvedName = named ? name.trim() || preset!.name : name.trim();
  const resolvedBaseUrl = named ? preset!.baseUrl : baseUrl;
  const resolvedApi = named ? preset!.api : api;

  const rows = useMemo<ModelRow[]>(() => {
    // models.dev 只补 row 里空着的字段；用户填过的值一律保留。
    const withDefaults = (row: ModelRow): ModelRow => {
      const fallback = defaults[defaultsKey(row.id)];
      if (!fallback) return row;
      return {
        ...row,
        displayName: row.displayName === row.id && fallback.name ? fallback.name : row.displayName,
        contextWindow: row.contextWindow ?? fallback.contextWindow,
        maxTokens: row.maxTokens ?? fallback.maxTokens,
        reasoning: row.reasoning ?? fallback.reasoning,
        input: row.input ?? fallback.input,
        thinkingLevels: row.thinkingLevels ?? fallback.thinkingLevels,
        defaultThinkingLevel: row.defaultThinkingLevel ?? fallback.defaultThinkingLevel,
        cost: row.cost ?? fallback.cost,
        source: fallback.source,
      };
    };

    const byId = new Map<string, ModelRow>();
    for (const model of remote) {
      byId.set(model.id.toLowerCase(), withDefaults({ id: model.id, displayName: model.name ?? model.id }));
    }
    for (const binding of models) {
      const key = binding.id.toLowerCase();
      const existing = byId.get(key);
      const merged: ModelRow = existing
        ? {
            ...existing,
            contextWindow: binding.contextWindow ?? existing.contextWindow,
            maxTokens: binding.maxTokens ?? existing.maxTokens,
            reasoning: binding.reasoning ?? existing.reasoning,
            input: binding.input ?? existing.input,
            thinkingLevels:
              binding.thinkingLevels.length > 0 ? binding.thinkingLevels : existing.thinkingLevels,
            defaultThinkingLevel: binding.defaultThinkingLevel ?? existing.defaultThinkingLevel,
            cost: binding.cost ?? existing.cost,
          }
        : {
            id: binding.id,
            displayName: binding.alias ?? binding.id,
            contextWindow: binding.contextWindow,
            maxTokens: binding.maxTokens,
            reasoning: binding.reasoning,
            input: binding.input,
            thinkingLevels: binding.thinkingLevels.length > 0 ? binding.thinkingLevels : undefined,
            defaultThinkingLevel: binding.defaultThinkingLevel,
            cost: binding.cost,
          };
      byId.set(key, withDefaults(merged));
    }
    return [...byId.values()];
  }, [remote, models, defaults]);

  /** 向 models.dev 要默认元数据：失败静默（默认值只是辅助信息）。 */
  const loadDefaults = async (ids: string[]) => {
    const unique = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
    if (unique.length === 0) return;
    setDefaultsLoading(true);
    try {
      const map = await loadModelDefaults({
        providerId: providerId.trim() || preset?.id,
        name: resolvedName || undefined,
        baseUrl: resolvedBaseUrl || undefined,
        modelIds: unique,
      });
      if (Object.keys(map).length === 0) return;
      setDefaults((prev) => {
        const next = { ...prev };
        for (const [id, value] of Object.entries(map)) next[defaultsKey(id)] = value;
        return next;
      });
    } finally {
      setDefaultsLoading(false);
    }
  };

  // 默认值到位后，把已选模型里仍为空的字段补齐（不碰用户填过的值）。
  useEffect(() => {
    if (Object.keys(defaults).length === 0) return;
    setModels((current) => {
      let changed = false;
      const next = current.map((binding) => {
        const fallback = defaults[defaultsKey(binding.id)];
        if (!fallback) return binding;
        const patch: Partial<UiModelBinding> = {};
        if (binding.contextWindow === undefined && fallback.contextWindow !== undefined) {
          patch.contextWindow = fallback.contextWindow;
        }
        if (binding.maxTokens === undefined && fallback.maxTokens !== undefined) {
          patch.maxTokens = fallback.maxTokens;
        }
        if (binding.input === undefined && fallback.input !== undefined) patch.input = fallback.input;
        if (binding.cost === undefined && fallback.cost !== undefined) patch.cost = fallback.cost;
        if (binding.thinkingLevels.length === 0 && (fallback.thinkingLevels?.length ?? 0) > 0) {
          patch.thinkingLevels = fallback.thinkingLevels;
          patch.defaultThinkingLevel = binding.defaultThinkingLevel ?? fallback.defaultThinkingLevel ?? null;
        }
        if (
          binding.reasoning === undefined &&
          (fallback.reasoning || (fallback.thinkingLevels?.length ?? 0) > 0)
        ) {
          patch.reasoning = true;
        }
        if (Object.keys(patch).length === 0) return binding;
        changed = true;
        return { ...binding, ...patch, source: binding.source ?? fallback.source };
      });
      return changed ? next : current;
    });
  }, [defaults]);

  const fetchModels = async () => {
    const url = resolvedBaseUrl.trim();
    if (!url) {
      pushToast("error", "请先填写 Base URL");
      return;
    }
    setLoading(true);
    setError(undefined);
    try {
      const list = await listRemoteModels(url, apiKey.trim() || initial?.apiKey);
      setRemote(list);
      pushToast("info", `已获取 ${list.length} 个模型`);
      void loadDefaults([...list.map((item) => item.id), ...models.map((item) => item.id)]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  };

  // 编辑已有服务时先补默认值，再探一次端点；新建时只补已选模型。
  useEffect(() => {
    void loadDefaults(models.map((model) => model.id));
    if (editingId && initialUi?.baseUrl) void fetchModels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Escape 关闭：保存中不响应，避免中断写入
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, saving]);

  const applyService = (next: string) => {
    setService(next);
    // 换了服务就是换了目录来源，旧默认值不能带过去
    setDefaults({});
    const nextPreset = SERVICE_PRESETS.find((item) => item.id === next);
    if (!nextPreset) return;
    setBaseUrl(nextPreset.baseUrl);
    setApi(nextPreset.api);
    if (nextPreset.apiKey && !apiKey) setApiKey(nextPreset.apiKey);
    if (!name.trim()) setName(nextPreset.name);
    if (!editingId && !providerId.trim()) setProviderId(nextPreset.id);
  };

  const save = async () => {
    const id = providerId.trim() || preset?.id || "";
    if (!id) {
      pushToast("error", "请填写提供商 ID");
      return;
    }
    if (!resolvedBaseUrl.trim()) {
      pushToast("error", "请填写 Base URL");
      return;
    }
    if (models.length === 0) {
      pushToast("error", "至少选择一个模型");
      return;
    }
    const provider: UiProvider = {
      id,
      name: resolvedName || id,
      baseUrl: resolvedBaseUrl,
      api: resolvedApi,
      apiKey: apiKey.trim() || initial?.apiKey,
      headers: pairsToRecord(pairs),
      enabled: true,
      models,
    };
    setSaving(true);
    try {
      await onSave(id, configFromProvider(provider));
      onClose();
    } catch (cause) {
      pushToast("error", cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center bg-scrim p-4">
      <div
        role="dialog"
        aria-modal="true"
        className="flex max-h-[90vh] w-full max-w-4xl flex-col rounded-surface border border-line bg-surface shadow-floating"
      >
        <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
          <h2 className="text-base font-medium">{editingId ? "编辑服务" : "添加 AI 服务"}</h2>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="rounded-control border border-line px-2 py-1 text-xs hover:border-accent"
              onClick={() => setAdvancedOpen((value) => !value)}
            >
              {advancedOpen ? "收起高级" : "高级设置"}
            </button>
            <button
              type="button"
              className="rounded-control border border-line px-2 py-1 text-xs"
              disabled={saving}
              onClick={onClose}
            >
              取消
            </button>
            <button
              type="button"
              className="rounded-control bg-accent-fill px-3 py-1 text-xs text-on-accent disabled:opacity-50"
              disabled={saving}
              onClick={() => void save()}
            >
              {saving ? "保存中…" : "保存"}
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-auto px-4 py-4">
          <div className="grid gap-3 md:grid-cols-2">
            <label className="text-sm">
              服务
              <div className="mt-1">
                <ServicePicker value={service} disabled={saving} onChange={applyService} />
              </div>
            </label>

            {named ? (
              <>
                <label className="text-sm">
                  API Key
                  <input
                    type="password"
                    autoFocus
                    className="mt-1 w-full rounded border border-line bg-canvas px-2 py-1 font-mono text-xs outline-none focus:border-accent"
                    value={apiKey}
                    placeholder={editingId && initial?.apiKey ? "留空则保留原有密钥" : "sk-…"}
                    onChange={(event) => setApiKey(event.target.value)}
                  />
                </label>
                <div className="text-xs text-ink-muted md:col-span-2">{resolvedBaseUrl}</div>
              </>
            ) : (
              <>
                <label className="text-sm">
                  提供商 ID
                  <input
                    className="mt-1 w-full rounded border border-line bg-canvas px-2 py-1 outline-none focus:border-accent"
                    value={providerId}
                    placeholder="例如 my-gateway"
                    onChange={(event) => setProviderId(event.target.value)}
                  />
                </label>
                <label className="text-sm">
                  名称
                  <input
                    className="mt-1 w-full rounded border border-line bg-canvas px-2 py-1 outline-none focus:border-accent"
                    value={name}
                    placeholder="显示名称"
                    onChange={(event) => setName(event.target.value)}
                  />
                </label>
                <label className="text-sm md:col-span-2">
                  Base URL
                  <input
                    className="mt-1 w-full rounded border border-line bg-canvas px-2 py-1 font-mono text-xs outline-none focus:border-accent"
                    value={baseUrl}
                    placeholder="https://api.example.com/v1"
                    onChange={(event) => setBaseUrl(event.target.value)}
                  />
                </label>
                <label className="text-sm">
                  API Key
                  <input
                    type="password"
                    className="mt-1 w-full rounded border border-line bg-canvas px-2 py-1 font-mono text-xs outline-none focus:border-accent"
                    value={apiKey}
                    placeholder={editingId && initial?.apiKey ? "留空则保留原有密钥" : "sk-…"}
                    onChange={(event) => setApiKey(event.target.value)}
                  />
                </label>
                <label className="text-sm">
                  API 风格
                  <select
                    className="mt-1 w-full rounded border border-line bg-canvas px-2 py-1"
                    value={api}
                    onChange={(event) => setApi(event.target.value)}
                  >
                    {API_STYLES.map((style) => (
                      <option key={style.id} value={style.id}>
                        {style.label}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )}
          </div>

          {advancedOpen && <HeaderEditor pairs={pairs} onChange={setPairs} />}

          <div className="flex items-center gap-2 text-2xs text-ink-muted">
            <span>上下文 / 最大输出 / 思考等级 / 参考价未填写时，自动取自 models.dev，可逐项改。</span>
            {defaultsLoading && <span className="text-accent">读取 models.dev 中…</span>}
          </div>

          <ModelSelectionPanes
            rows={rows}
            models={models}
            setModels={setModels}
            loading={loading}
            error={error}
            canReload={Boolean(resolvedBaseUrl.trim())}
            onReload={() => void fetchModels()}
            onModelAdded={(id) => void loadDefaults([id])}
            busy={saving}
            listTitle="服务模型"
          />
        </div>
      </div>
    </div>,
    document.body,
  );
}
