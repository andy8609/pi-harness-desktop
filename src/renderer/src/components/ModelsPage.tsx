import { Check, HardDrives, Plus, Trash } from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CustomProviderConfig, ModelsFile } from "@shared/types";
import { refreshModels, useAppStore } from "../stores/app-store";
import { ProviderDialog } from "./models/ProviderDialog";
import { listProviders, type UiProvider } from "./models/types";
import {
  Badge,
  Button,
  EmptyState,
  IconButton,
  PageBody,
  PageHeader,
  PageShell,
  Section,
  SkeletonList,
  Switch,
  cx,
  inputClass,
  textareaClass,
} from "./ui";

const DELETE_CONFIRM_MS = 3000;

function hostFromBaseUrl(baseUrl?: string): string {
  if (!baseUrl) return "—";
  try {
    return new URL(baseUrl).host || baseUrl;
  } catch {
    return baseUrl.replace(/^https?:\/\//, "").split("/")[0] || baseUrl;
  }
}

/** 默认模型行：当前值 + 可搜索、按服务分组的模型选择器。 */
function DefaultModelSection({ providers }: { providers: UiProvider[] }) {
  const models = useAppStore((state) => state.models);
  const settings = useAppStore((state) => state.settings);
  const pushToast = useAppStore((state) => state.pushToast);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const currentProvider = settings.defaultProvider ?? "";
  const currentModel = settings.defaultModel ?? "";
  const providerName = providers.find((provider) => provider.id === currentProvider)?.name ?? currentProvider;

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
      await refreshModels();
      pushToast("info", `默认模型已设为 ${provider}/${id}`);
    } catch (error) {
      pushToast("error", error instanceof Error ? error.message : String(error));
    } finally {
      setOpen(false);
    }
  };

  return (
    <Section title="默认模型" description="新会话默认使用该模型；对话输入区可随时临时切换。">
      <div className="flex items-center justify-between gap-3 rounded-panel border border-line bg-surface px-4 py-3">
        <div className="min-w-0">
          {currentProvider && currentModel ? (
            <div className="truncate text-sm text-ink">
              <span className="font-medium">{providerName}</span>
              <span className="mx-1 text-ink-muted">·</span>
              <span className="font-mono text-ink-soft">{currentModel}</span>
            </div>
          ) : (
            <div className="text-sm text-ink-soft">
              {models.length === 0 ? "尚未配置任何模型" : "尚未设置默认模型"}
            </div>
          )}
        </div>
        <div className="relative shrink-0">
          <Button
            size="sm"
            disabled={models.length === 0}
            aria-haspopup="listbox"
            aria-expanded={open}
            onClick={() => {
              setQuery("");
              setOpen((value) => !value);
            }}
          >
            更改默认模型
          </Button>
          {open && (
            <div
              role="listbox"
              aria-label="选择默认模型"
              className="absolute right-0 z-[var(--z-popover)] mt-1 w-80 rounded-panel border border-line bg-surface p-2 shadow-floating"
            >
              <input
                autoFocus
                type="search"
                aria-label="搜索模型"
                className={cx(inputClass, "mb-2")}
                placeholder="搜索模型"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              <div className="max-h-72 overflow-auto">
                {grouped.length === 0 ? (
                  <div className="px-2 py-1 text-xs text-ink-muted">无匹配模型</div>
                ) : (
                  grouped.map(([provider, list]) => (
                    <div key={provider}>
                      <div className="px-2 pt-2 pb-1 text-2xs text-ink-muted">{provider}</div>
                      {list.map((model) => {
                        const isCurrent = provider === currentProvider && model.id === currentModel;
                        return (
                          <button
                            key={`${provider}/${model.id}`}
                            type="button"
                            role="option"
                            aria-selected={isCurrent}
                            className={cx(
                              "flex w-full items-center gap-2 rounded-control px-2 py-1 text-left text-xs hover:bg-surface-raised",
                              isCurrent ? "text-accent" : "text-ink",
                            )}
                            onClick={() => void setDefault(provider, model.id)}
                          >
                            <span className="w-3 shrink-0">{isCurrent ? <Check size={12} /> : null}</span>
                            <span className="min-w-0 flex-1 truncate font-mono">{model.id}</span>
                            {!model.available && <span className="shrink-0 text-2xs text-ink-muted">未配置认证</span>}
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
    </Section>
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
  const [loading, setLoading] = useState(true);
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const providers = useMemo(() => listProviders(file), [file]);
  const settings = useAppStore((state) => state.settings);

  useEffect(() => {
    void (async () => {
      try {
        const result = await window.pi.getModelsFile();
        setFile(result.file);
        setPath(result.path);
        setRaw(JSON.stringify(result.file, null, 2));
        if (result.error) pushToast("error", `models.json 解析失败: ${result.error}`);
      } finally {
        setLoading(false);
      }
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
    await refreshModels();
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
    await refreshModels();
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
    <PageShell>
      <PageHeader
        title="模型配置"
        description={`文件位置 ${path || "~/.pi/agent/models.json"}。保存后立即生效，无需重启。`}
      />

      <PageBody>
        {loading ? (
          <SkeletonList rows={3} />
        ) : (
          <>
        <DefaultModelSection providers={providers} />

        <Section
          title={
            <span className="flex items-center gap-2">
              已配置的服务
              {providers.length > 0 && <Badge>{providers.length}</Badge>}
            </span>
          }
          description="启用的服务会出现在模型列表中；设为默认的服务决定新会话使用的模型。"
          actions={
            providers.length > 0 ? (
              <Button size="sm" variant="primary" icon={<Plus size={13} />} onClick={() => setDialog({ editingId: null })}>
                添加服务
              </Button>
            ) : undefined
          }
        >
          <div className="rounded-panel border border-line bg-surface">
            {providers.length === 0 ? (
              <div className="p-4">
                <EmptyState
                  icon={<HardDrives size={22} />}
                  title="尚未配置 AI 服务"
                  description="接入 OpenAI 兼容接口、Anthropic、Gemini 或本地模型（Ollama / LM Studio / vLLM）。配置会写入 models.json。"
                  action={
                    <Button variant="primary" icon={<Plus size={13} />} onClick={() => setDialog({ editingId: null })}>
                      添加服务
                    </Button>
                  }
                />
              </div>
            ) : (
              <ul className="divide-y divide-line-subtle">
                {providers.map((provider) => {
                  const isDefault = settings.defaultProvider === provider.id;
                  const confirming = confirmDeleteId === provider.id;
                  const hasSecret = Boolean(provider.apiKey);
                  const switchId = `provider-${provider.id}-enabled`;
                  return (
                    <li
                      key={provider.id}
                      className={cx("flex items-center gap-3 px-4 py-3", provider.enabled ? "" : "opacity-60")}
                    >
                      <Switch
                        id={switchId}
                        checked={provider.enabled}
                        label={`启用 ${provider.name}`}
                        onChange={() => void toggleEnabled(provider)}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <label htmlFor={switchId} className="font-medium text-ink">
                            {provider.name}
                          </label>
                          {isDefault && <Badge tone="success">默认</Badge>}
                          {!hasSecret && <Badge tone="warning">无密钥</Badge>}
                          {!provider.enabled && <Badge>已禁用</Badge>}
                        </div>
                        <div className="mt-0.5 truncate text-xs text-ink-muted">
                          {hostFromBaseUrl(provider.baseUrl)} · {provider.models.length} 个模型
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        {!isDefault && (
                          <Button
                            size="sm"
                            disabled={provider.models.length === 0}
                            onClick={() => void makeDefault(provider)}
                          >
                            设为默认
                          </Button>
                        )}
                        <Button
                          size="sm"
                          onClick={() =>
                            setDialog({
                              editingId: provider.id,
                              initial: (file.providers ?? {})[provider.id],
                            })
                          }
                        >
                          编辑
                        </Button>
                        {confirming ? (
                          <Button size="sm" variant="danger" onClick={() => void removeProvider(provider.id)}>
                            确认删除
                          </Button>
                        ) : (
                          <IconButton
                            size="sm"
                            variant="danger"
                            label={`删除服务 ${provider.name}`}
                            onClick={() => setConfirmDeleteId(provider.id)}
                          >
                            <Trash size={13} />
                          </IconButton>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </Section>

        <Section
          title="高级 JSON"
          description="直接编辑 models.json。保存前会做格式校验，失败时提示具体原因。"
          actions={
            <Button size="sm" onClick={() => setRawMode((value) => !value)}>
              {rawMode ? "收起" : "展开"}
            </Button>
          }
        >
          {rawMode && (
            <div className="rounded-panel border border-line bg-surface p-4">
              <textarea
                aria-label="models.json 内容"
                className={cx(textareaClass, "h-64 font-mono text-xs")}
                value={raw}
                onChange={(event) => setRaw(event.target.value)}
              />
              <div className="mt-2 flex justify-end">
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => {
                    try {
                      void save(JSON.parse(raw) as ModelsFile).then(() => pushToast("info", "已保存 models.json"));
                    } catch (error) {
                      pushToast("error", error instanceof Error ? error.message : String(error));
                    }
                  }}
                >
                  保存 JSON
                </Button>
              </div>
            </div>
          )}
        </Section>
          </>
        )}
      </PageBody>

      {dialog && (
        <ProviderDialog
          editingId={dialog.editingId}
          initial={dialog.initial}
          onClose={() => setDialog(null)}
          onSave={saveProvider}
        />
      )}
    </PageShell>
  );
}
