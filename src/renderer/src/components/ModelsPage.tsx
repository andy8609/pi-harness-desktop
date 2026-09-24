import { CaretDown, Check, HardDrives, Plus } from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { CustomProviderConfig, ModelsFile } from "@shared/types";
import { refreshModelsAndSessions, useAppStore } from "../stores/app-store";
import { ProviderDialog } from "./models/ProviderDialog";
import { listProviders, type UiProvider } from "./models/types";

const DELETE_CONFIRM_MS = 3000;

function hostFromBaseUrl(baseUrl?: string): string {
  if (!baseUrl) return "—";
  try {
    return new URL(baseUrl).host || baseUrl;
  } catch {
    return baseUrl.replace(/^https?:\/\//, "").split("/")[0] || baseUrl;
  }
}

function Badge({ children, tone }: { children: ReactNode; tone?: "success" | "warning" | "neutral" }) {
  const color =
    tone === "success"
      ? "border-[var(--ok)] text-[var(--ok)]"
      : tone === "warning"
        ? "border-[var(--danger)] text-[var(--danger)]"
        : "border-[var(--line)] text-[var(--muted)]";
  return <span className={`rounded border px-1.5 py-0.5 text-[10px] ${color}`}>{children}</span>;
}

/** Default model row: current value plus a searchable, provider-grouped picker. */
function DefaultModelSection({ providers }: { providers: UiProvider[] }) {
  const models = useAppStore((state) => state.models);
  const settings = useAppStore((state) => state.settings);
  const pushToast = useAppStore((state) => state.pushToast);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const currentProvider = settings.defaultProvider ?? "";
  const currentModel = settings.defaultModel ?? "";
  const providerName =
    providers.find((provider) => provider.id === currentProvider)?.name ?? currentProvider;

  const grouped = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = needle
      ? models.filter((model) => `${model.provider}/${model.id} ${model.name}`.toLowerCase().includes(needle))
      : models;
    const map = new Map<string, typeof filtered>();
    for (const model of filtered) {
      const list = map.get(model.provider) ?? [];
      list.push(model);
      map.set(model.provider, list);
    }
    return [...map.entries()];
  }, [models, query]);

  const setDefault = async (provider: string, id: string) => {
    try {
      await window.pi.updateSettings({ defaultProvider: provider, defaultModel: id });
      await refreshModelsAndSessions();
      pushToast("info", `默认模型已设为 ${provider}/${id}`);
    } catch (error) {
      pushToast("error", error instanceof Error ? error.message : String(error));
    } finally {
      setOpen(false);
    }
  };

  return (
    <section className="mb-6">
      <h2 className="mb-2 text-sm font-medium text-[var(--muted)]">默认</h2>
      <div className="rounded-xl border border-[var(--line)] bg-[var(--bg-panel)] p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-medium">默认模型</div>
            {currentProvider && currentModel ? (
              <div className="mt-0.5 truncate text-xs text-[var(--muted)]">
                <span className="text-[var(--text)]">{providerName}</span> ·{" "}
                <span className="font-mono">{currentModel}</span>
              </div>
            ) : (
              <div className="mt-0.5 text-xs text-[var(--muted)]">
                {models.length === 0 ? "尚未配置任何模型" : "尚未设置默认模型"}
              </div>
            )}
          </div>
          <div className="relative shrink-0">
            <button
              type="button"
              className="flex items-center gap-1 rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs hover:border-[var(--accent)] disabled:opacity-50"
              disabled={models.length === 0}
              aria-haspopup="listbox"
              aria-expanded={open}
              onClick={() => {
                setQuery("");
                setOpen((value) => !value);
              }}
            >
              更改默认模型
              <CaretDown size={13} />
            </button>
            {open && (
              <div className="absolute right-0 z-30 mt-1 w-80 rounded-lg border border-[var(--line)] bg-[var(--bg-panel)] p-2 shadow-xl">
                <input
                  autoFocus
                  className="mb-2 w-full rounded border border-[var(--line)] bg-[var(--bg)] px-2 py-1 text-xs outline-none focus:border-[var(--accent)]"
                  placeholder="搜索模型"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
                <div className="max-h-72 overflow-auto">
                  {grouped.length === 0 ? (
                    <div className="px-2 py-1 text-xs text-[var(--muted)]">无匹配模型</div>
                  ) : (
                    grouped.map(([provider, list]) => (
                      <div key={provider}>
                        <div className="px-2 pt-2 pb-1 text-[10px] uppercase tracking-wide text-[var(--muted)]">
                          {provider}
                        </div>
                        {list.map((model) => {
                          const isCurrent = provider === currentProvider && model.id === currentModel;
                          return (
                            <button
                              key={`${provider}/${model.id}`}
                              type="button"
                              role="option"
                              aria-selected={isCurrent}
                              className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs hover:bg-[var(--bg-raised)] ${
                                isCurrent ? "text-[var(--accent)]" : ""
                              }`}
                              onClick={() => void setDefault(provider, model.id)}
                            >
                              <span className="w-3 shrink-0">
                                {isCurrent ? <Check size={12} /> : null}
                              </span>
                              <span className="min-w-0 flex-1 truncate font-mono">{model.id}</span>
                              {!model.available && (
                                <span className="shrink-0 text-[10px] text-[var(--muted)]">未配置认证</span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

export function ModelsPage() {
  const pushToast = useAppStore((state) => state.pushToast);
  const [file, setFile] = useState<ModelsFile>({ providers: {} });
  const [path, setPath] = useState("");
  const [rawMode, setRawMode] = useState(false);
  const [raw, setRaw] = useState("");
  const [dialog, setDialog] = useState<{ editingId: string | null; initial?: CustomProviderConfig } | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const providers = useMemo(() => listProviders(file), [file]);
  const settings = useAppStore((state) => state.settings);

  useEffect(() => {
    void (async () => {
      const result = await window.pi.getModelsFile();
      setFile(result.file);
      setPath(result.path);
      setRaw(JSON.stringify(result.file, null, 2));
      if (result.error) pushToast("error", `models.json 解析失败: ${result.error}`);
    })();
  }, []);

  useEffect(() => {
    if (!confirmDeleteId) return;
    confirmTimer.current = setTimeout(() => setConfirmDeleteId(null), DELETE_CONFIRM_MS);
    return () => {
      if (confirmTimer.current) clearTimeout(confirmTimer.current);
    };
  }, [confirmDeleteId]);

  const save = async (next: ModelsFile) => {
    await window.pi.saveModelsFile(next);
    await refreshModelsAndSessions();
    setFile(next);
    setRaw(JSON.stringify(next, null, 2));
  };

  const saveProvider = async (id: string, config: CustomProviderConfig) => {
    const providersMap = { ...(file.providers ?? {}) };
    if (dialog?.editingId && dialog.editingId !== id) delete providersMap[dialog.editingId];
    providersMap[id] = config;
    await save({ ...file, providers: providersMap });
    pushToast("info", `已保存服务 ${id}`);
  };

  const toggleEnabled = async (provider: UiProvider) => {
    const providersMap = { ...(file.providers ?? {}) };
    const existing = providersMap[provider.id];
    if (!existing) return;
    providersMap[provider.id] = { ...existing, enabled: !provider.enabled };
    await save({ ...file, providers: providersMap });
    pushToast("info", provider.enabled ? `已禁用 ${provider.id}` : `已启用 ${provider.id}`);
  };

  const makeDefault = async (provider: UiProvider) => {
    const first = provider.models[0]?.id;
    if (!first) {
      pushToast("error", "该服务还没有模型");
      return;
    }
    await window.pi.updateSettings({ defaultProvider: provider.id, defaultModel: first });
    await refreshModelsAndSessions();
    pushToast("info", `默认模型已设为 ${provider.id}/${first}`);
  };

  const removeProvider = async (id: string) => {
    setConfirmDeleteId(null);
    const providersMap = { ...(file.providers ?? {}) };
    delete providersMap[id];
    await save({ ...file, providers: providersMap });
    pushToast("info", `已删除服务 ${id}`);
  };

  return (
    <section className="h-full overflow-auto px-6 py-5">
      <div className="mb-5">
        <h1 className="text-xl font-semibold">模型配置</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          文件位置 {path || "~/.pi/agent/models.json"}。保存后立即生效，无需重启。
        </p>
      </div>

      <DefaultModelSection providers={providers} />

      <section className="mb-6">
        <div className="mb-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-medium text-[var(--muted)]">已配置的 AI 服务</h2>
            {providers.length > 0 && (
              <span className="rounded bg-[var(--bg-raised)] px-1.5 text-[10px] text-[var(--muted)]">
                {providers.length}
              </span>
            )}
          </div>
          <button
            type="button"
            className="flex items-center gap-1 rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs text-[#16180f]"
            onClick={() => setDialog({ editingId: null })}
          >
            <Plus size={13} />
            添加服务
          </button>
        </div>

        <div className="rounded-xl border border-[var(--line)] bg-[var(--bg-panel)]">
          {providers.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
              <HardDrives size={20} className="text-[var(--muted)]" />
              <div className="text-sm font-medium">尚未配置 AI 服务</div>
              <div className="max-w-md text-xs text-[var(--muted)]">
                接入 OpenAI 兼容接口、Anthropic、Gemini 或本地模型（Ollama / LM Studio / vLLM）。
              </div>
              <button
                type="button"
                className="mt-1 flex items-center gap-1 rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs text-[#16180f]"
                onClick={() => setDialog({ editingId: null })}
              >
                <Plus size={13} />
                添加服务
              </button>
            </div>
          ) : (
            <ul>
              {providers.map((provider) => {
                const isDefault = settings.defaultProvider === provider.id;
                const confirming = confirmDeleteId === provider.id;
                const hasSecret = Boolean(provider.apiKey);
                return (
                  <li
                    key={provider.id}
                    className={`flex items-center justify-between gap-3 border-b border-[var(--line)] px-4 py-3 last:border-b-0 ${
                      provider.enabled ? "" : "opacity-60"
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{provider.name}</span>
                        {isDefault && <Badge tone="success">默认</Badge>}
                        {!hasSecret && <Badge tone="warning">无密钥</Badge>}
                        {!provider.enabled && <Badge>已禁用</Badge>}
                      </div>
                      <div className="mt-0.5 truncate text-xs text-[var(--muted)]">
                        {hostFromBaseUrl(provider.baseUrl)} · {provider.models.length} 个模型
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      {!isDefault && (
                        <button
                          type="button"
                          className="rounded border border-[var(--line)] px-2 py-1 text-xs hover:border-[var(--accent)] disabled:opacity-50"
                          disabled={provider.models.length === 0}
                          onClick={() => void makeDefault(provider)}
                        >
                          设为默认
                        </button>
                      )}
                      <button
                        type="button"
                        className="rounded border border-[var(--line)] px-2 py-1 text-xs hover:border-[var(--accent)]"
                        onClick={() =>
                          setDialog({
                            editingId: provider.id,
                            initial: (file.providers ?? {})[provider.id],
                          })
                        }
                      >
                        编辑
                      </button>
                      {confirming ? (
                        <button
                          type="button"
                          className="rounded border border-[var(--danger)] px-2 py-1 text-xs text-[var(--danger)]"
                          onClick={() => void removeProvider(provider.id)}
                        >
                          确认删除
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="rounded border border-[var(--line)] px-2 py-1 text-xs hover:border-[var(--danger)] hover:text-[var(--danger)]"
                          onClick={() => setConfirmDeleteId(provider.id)}
                        >
                          删除
                        </button>
                      )}
                      <button
                        type="button"
                        role="switch"
                        aria-checked={provider.enabled}
                        title={provider.enabled ? "禁用" : "启用"}
                        className={`relative h-5 w-9 shrink-0 rounded-full border transition-colors ${
                          provider.enabled
                            ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                            : "border-[var(--line)] bg-[var(--bg-raised)]"
                        }`}
                        onClick={() => void toggleEnabled(provider)}
                      >
                        <span
                          className={`absolute top-0.5 h-3.5 w-3.5 rounded-full transition-all ${
                            provider.enabled
                              ? "left-[18px] bg-[var(--accent)]"
                              : "left-0.5 bg-[var(--muted)]"
                          }`}
                        />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

      <section className="rounded-xl border border-[var(--line)] bg-[var(--bg-panel)] p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-medium text-[var(--muted)]">高级 JSON</h2>
          <button
            type="button"
            className="text-xs text-[var(--accent)]"
            onClick={() => setRawMode((value) => !value)}
          >
            {rawMode ? "收起" : "展开"}
          </button>
        </div>
        {rawMode && (
          <div>
            <textarea
              className="h-64 w-full rounded border border-[var(--line)] bg-[var(--bg)] p-2 font-mono text-xs"
              value={raw}
              onChange={(event) => setRaw(event.target.value)}
            />
            <button
              type="button"
              className="mt-2 rounded bg-[var(--accent)] px-3 py-1 text-sm text-[#16180f]"
              onClick={() => {
                try {
                  void save(JSON.parse(raw) as ModelsFile).then(() =>
                    pushToast("info", "已保存 models.json"),
                  );
                } catch (error) {
                  pushToast("error", error instanceof Error ? error.message : String(error));
                }
              }}
            >
              保存 JSON
            </button>
          </div>
        )}
      </section>

      {dialog && (
        <ProviderDialog
          editingId={dialog.editingId}
          initial={dialog.initial}
          onClose={() => setDialog(null)}
          onSave={saveProvider}
        />
      )}
    </section>
  );
}
