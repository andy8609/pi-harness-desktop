import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { CustomProviderConfig } from "@shared/types";
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
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);

  const preset = SERVICE_PRESETS.find((item) => item.id === service);
  const named = Boolean(preset);
  const custom = service === CUSTOM_SERVICE;
  const resolvedName = named ? name.trim() || preset!.name : name.trim();
  const resolvedBaseUrl = named ? preset!.baseUrl : baseUrl;
  const resolvedApi = named ? preset!.api : api;

  const rows = useMemo<ModelRow[]>(() => {
    const byId = new Map<string, ModelRow>();
    for (const model of remote) {
      byId.set(model.id.toLowerCase(), { id: model.id, displayName: model.name ?? model.id });
    }
    for (const binding of models) {
      const key = binding.id.toLowerCase();
      const existing = byId.get(key);
      if (existing) {
        byId.set(key, { ...existing, contextWindow: binding.contextWindow, maxTokens: binding.maxTokens });
      } else {
        byId.set(key, {
          id: binding.id,
          displayName: binding.alias ?? binding.id,
          contextWindow: binding.contextWindow,
          maxTokens: binding.maxTokens,
        });
      }
    }
    return [...byId.values()];
  }, [remote, models]);

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
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  };

  // Editing an existing service probes its endpoint once on open.
  useEffect(() => {
    if (editingId && initialUi?.baseUrl) void fetchModels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyService = (next: string) => {
    setService(next);
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--overlay)] p-4">
      <div
        role="dialog"
        aria-modal="true"
        className="flex max-h-[90vh] w-full max-w-4xl flex-col rounded-2xl border border-[var(--line)] bg-[var(--bg-panel)]"
      >
        <div className="flex items-center justify-between gap-2 border-b border-[var(--line)] px-4 py-3">
          <h2 className="text-base font-medium">{editingId ? "编辑服务" : "添加 AI 服务"}</h2>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="rounded-lg border border-[var(--line)] px-2 py-1 text-xs hover:border-[var(--accent)]"
              onClick={() => setAdvancedOpen((value) => !value)}
            >
              {advancedOpen ? "收起高级" : "高级设置"}
            </button>
            <button
              type="button"
              className="rounded-lg border border-[var(--line)] px-2 py-1 text-xs"
              disabled={saving}
              onClick={onClose}
            >
              取消
            </button>
            <button
              type="button"
              className="rounded-lg bg-[var(--accent-bg)] px-3 py-1 text-xs text-[var(--on-accent)] disabled:opacity-50"
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
                    className="mt-1 w-full rounded border border-[var(--line)] bg-[var(--bg)] px-2 py-1 font-mono text-xs outline-none focus:border-[var(--accent)]"
                    value={apiKey}
                    placeholder={editingId && initial?.apiKey ? "留空则保留原有密钥" : "sk-…"}
                    onChange={(event) => setApiKey(event.target.value)}
                  />
                </label>
                <div className="text-xs text-[var(--muted)] md:col-span-2">{resolvedBaseUrl}</div>
              </>
            ) : (
              <>
                <label className="text-sm">
                  提供商 ID
                  <input
                    className="mt-1 w-full rounded border border-[var(--line)] bg-[var(--bg)] px-2 py-1 outline-none focus:border-[var(--accent)]"
                    value={providerId}
                    placeholder="例如 my-gateway"
                    onChange={(event) => setProviderId(event.target.value)}
                  />
                </label>
                <label className="text-sm">
                  名称
                  <input
                    className="mt-1 w-full rounded border border-[var(--line)] bg-[var(--bg)] px-2 py-1 outline-none focus:border-[var(--accent)]"
                    value={name}
                    placeholder="显示名称"
                    onChange={(event) => setName(event.target.value)}
                  />
                </label>
                <label className="text-sm md:col-span-2">
                  Base URL
                  <input
                    className="mt-1 w-full rounded border border-[var(--line)] bg-[var(--bg)] px-2 py-1 font-mono text-xs outline-none focus:border-[var(--accent)]"
                    value={baseUrl}
                    placeholder="https://api.example.com/v1"
                    onChange={(event) => setBaseUrl(event.target.value)}
                  />
                </label>
                <label className="text-sm">
                  API Key
                  <input
                    type="password"
                    className="mt-1 w-full rounded border border-[var(--line)] bg-[var(--bg)] px-2 py-1 font-mono text-xs outline-none focus:border-[var(--accent)]"
                    value={apiKey}
                    placeholder={editingId && initial?.apiKey ? "留空则保留原有密钥" : "sk-…"}
                    onChange={(event) => setApiKey(event.target.value)}
                  />
                </label>
                <label className="text-sm">
                  API 风格
                  <select
                    className="mt-1 w-full rounded border border-[var(--line)] bg-[var(--bg)] px-2 py-1"
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

          <ModelSelectionPanes
            rows={rows}
            models={models}
            setModels={setModels}
            loading={loading}
            error={error}
            canReload={Boolean(resolvedBaseUrl.trim())}
            onReload={() => void fetchModels()}
            busy={saving}
            listTitle="服务模型"
          />
        </div>
      </div>
    </div>,
    document.body,
  );
}
