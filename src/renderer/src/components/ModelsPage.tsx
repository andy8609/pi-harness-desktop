import { useEffect, useMemo, useState } from "react";
import type { CustomModelConfig, CustomProviderConfig, ModelsFile } from "@shared/types";
import { listRemoteModels, type RemoteModel } from "../lib/remote-models";
import { refreshModelsAndSessions, useAppStore } from "../stores/app-store";

const TEMPLATES: Record<string, CustomProviderConfig> = {
  ollama: {
    baseUrl: "http://localhost:11434/v1",
    api: "openai-completions",
    apiKey: "ollama",
    compat: { supportsDeveloperRole: false, supportsReasoningEffort: false },
    models: [{ id: "llama3.1:8b", name: "Llama 3.1 8B" }],
  },
  lmstudio: {
    baseUrl: "http://localhost:1234/v1",
    api: "openai-completions",
    apiKey: "lmstudio",
    models: [{ id: "local-model" }],
  },
  vllm: {
    baseUrl: "http://localhost:8000/v1",
    api: "openai-completions",
    apiKey: "vllm",
    models: [{ id: "your-model" }],
  },
};

export function ModelsPage() {
  const pushToast = useAppStore((state) => state.pushToast);
  const [file, setFile] = useState<ModelsFile>({ providers: {} });
  const [path, setPath] = useState("");
  const [rawMode, setRawMode] = useState(false);
  const [raw, setRaw] = useState("");
  const [providerId, setProviderId] = useState("ollama");
  const [draft, setDraft] = useState<CustomProviderConfig>(TEMPLATES.ollama);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [remoteModels, setRemoteModels] = useState<RemoteModel[]>([]);
  const [selectedRemote, setSelectedRemote] = useState<Set<string>>(new Set());
  const [remoteQuery, setRemoteQuery] = useState("");
  const [fetchingModels, setFetchingModels] = useState(false);

  const customProviders = Object.entries(file.providers ?? {});
  const filteredRemote = useMemo(() => {
    const needle = remoteQuery.trim().toLowerCase();
    if (!needle) return remoteModels;
    return remoteModels.filter(
      (model) => model.id.toLowerCase().includes(needle) || (model.name ?? "").toLowerCase().includes(needle),
    );
  }, [remoteModels, remoteQuery]);

  const load = async () => {
    const result = await window.pi.getModelsFile();
    setFile(result.file);
    setPath(result.path);
    setRaw(JSON.stringify(result.file, null, 2));
    if (result.error) pushToast("error", `models.json 解析失败: ${result.error}`);
  };

  useEffect(() => {
    void load();
  }, []);

  const save = async (next: ModelsFile) => {
    await window.pi.saveModelsFile(next);
    await refreshModelsAndSessions();
    setFile(next);
    setRaw(JSON.stringify(next, null, 2));
    pushToast("info", "已保存 models.json 并刷新模型目录");
  };

  const startEdit = (id: string, provider: CustomProviderConfig) => {
    setEditingId(id);
    setProviderId(id);
    setDraft({
      ...provider,
      models: (provider.models ?? []).map((model) => ({ ...model })),
    });
    setRemoteModels([]);
    setSelectedRemote(new Set((provider.models ?? []).map((model) => model.id)));
  };

  const resetForm = () => {
    setEditingId(null);
    setProviderId("ollama");
    setDraft(TEMPLATES.ollama);
    setRemoteModels([]);
    setSelectedRemote(new Set());
    setRemoteQuery("");
  };

  const closeModelPicker = () => {
    setRemoteModels([]);
    setRemoteQuery("");
  };

  const applySelectedModels = (ids: Set<string>, catalog: RemoteModel[]) => {
    const byId = new Map((draft.models ?? []).map((model) => [model.id, model]));
    for (const model of catalog) {
      if (!byId.has(model.id)) byId.set(model.id, { id: model.id, name: model.name });
    }
    const next: CustomModelConfig[] = [...ids].map((id) => byId.get(id) ?? { id });
    setDraft({ ...draft, models: next });
    closeModelPicker();
  };

  return (
    <section className="h-full overflow-auto px-6 py-5">
      <div className="mb-4">
        <h1 className="text-xl font-semibold">自定义模型</h1>
        <p className="mt-1 text-sm text-[#9a937c]">文件位置 {path || "~/.pi/agent/models.json"}。保存后无需重启。当前会话模型请在对话顶栏选择。</p>
      </div>

      <div className="mb-6 rounded-xl border border-[#33392a] bg-[#1a1d16] p-4">
        <h2 className="mb-3 font-medium">{editingId ? `修改提供商 ${editingId}` : "添加自定义提供商"}</h2>
        <div className="mb-3 flex flex-wrap gap-2">
          {Object.keys(TEMPLATES).map((key) => (
            <button
              key={key}
              className="rounded-full border border-[#33392a] px-3 py-1 text-xs hover:border-[#c4d45a]"
              onClick={() => {
                setEditingId(null);
                setProviderId(key);
                setDraft(TEMPLATES[key]);
                setRemoteModels([]);
                setSelectedRemote(new Set((TEMPLATES[key].models ?? []).map((model) => model.id)));
              }}
            >
              {key}
            </button>
          ))}
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="text-sm">
            ID
            <input className="mt-1 w-full rounded border border-[#33392a] bg-[#12140f] px-2 py-1" value={providerId} onChange={(e) => setProviderId(e.target.value)} />
          </label>
          <label className="text-sm">
            API
            <select
              className="mt-1 w-full rounded border border-[#33392a] bg-[#12140f] px-2 py-1"
              value={draft.api ?? "openai-completions"}
              onChange={(e) => setDraft({ ...draft, api: e.target.value })}
            >
              <option value="openai-completions">openai-completions</option>
              <option value="openai-responses">openai-responses</option>
              <option value="anthropic-messages">anthropic-messages</option>
              <option value="google-generative-ai">google-generative-ai</option>
            </select>
          </label>
          <label className="text-sm md:col-span-2">
            Base URL
            <input className="mt-1 w-full rounded border border-[#33392a] bg-[#12140f] px-2 py-1" value={draft.baseUrl ?? ""} onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })} />
          </label>
          <label className="text-sm">
            API Key / $ENV
            <input
              type="password"
              className="mt-1 w-full rounded border border-[#33392a] bg-[#12140f] px-2 py-1"
              value={draft.apiKey ?? ""}
              onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
            />
          </label>
          <label className="text-sm">
            模型 ID（逗号分隔）
            <div className="mt-1 flex gap-2">
              <input
                className="min-w-0 flex-1 rounded border border-[#33392a] bg-[#12140f] px-2 py-1"
                value={(draft.models ?? []).map((model) => model.id).join(",")}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    models: e.target.value
                      .split(",")
                      .map((id) => id.trim())
                      .filter(Boolean)
                      .map((id) => ({ id })),
                  })
                }
              />
              <button
                className="shrink-0 rounded border border-[#33392a] px-3 py-1 text-xs disabled:opacity-50"
                disabled={fetchingModels}
                onClick={async () => {
                  setFetchingModels(true);
                  try {
                    const models = await listRemoteModels(draft.baseUrl ?? "", draft.apiKey);
                    setRemoteModels(models);
                    setSelectedRemote(new Set((draft.models ?? []).map((model) => model.id).filter((id) => models.some((model) => model.id === id))));
                    pushToast("info", `已获取 ${models.length} 个模型，可多选后应用`);
                  } catch (error) {
                    pushToast("error", error instanceof Error ? error.message : String(error));
                  } finally {
                    setFetchingModels(false);
                  }
                }}
              >
                {fetchingModels ? "获取中…" : "获取模型列表"}
              </button>
            </div>
          </label>
        </div>

        {remoteModels.length > 0 && (
          <div className="mt-3 rounded-lg border border-[#33392a] bg-[#12140f] p-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm">已选 {selectedRemote.size} / {remoteModels.length}</div>
              <div className="flex items-center gap-2">
                <input
                  className="w-44 rounded border border-[#33392a] bg-[#1a1d16] px-2 py-1 text-xs"
                  placeholder="筛选模型"
                  value={remoteQuery}
                  onChange={(e) => setRemoteQuery(e.target.value)}
                />
                <button
                  className="text-xs text-[#c4d45a]"
                  onClick={() => setSelectedRemote(new Set(filteredRemote.map((model) => model.id)))}
                >
                  全选当前
                </button>
                <button className="text-xs text-[#9a937c]" onClick={() => setSelectedRemote(new Set())}>
                  清空
                </button>
                <button className="rounded border border-[#33392a] px-2 py-1 text-xs" onClick={closeModelPicker}>
                  关闭
                </button>
              </div>
            </div>
            <div className="max-h-56 space-y-1 overflow-auto text-sm">
              {filteredRemote.map((model) => (
                <label key={model.id} className="flex items-center gap-2 rounded px-1 py-0.5 hover:bg-[#1a1d16]">
                  <input
                    type="checkbox"
                    checked={selectedRemote.has(model.id)}
                    onChange={(event) => {
                      const next = new Set(selectedRemote);
                      if (event.target.checked) next.add(model.id);
                      else next.delete(model.id);
                      setSelectedRemote(next);
                    }}
                  />
                  <span className="truncate">{model.id}</span>
                  {model.name && <span className="truncate text-xs text-[#9a937c]">{model.name}</span>}
                </label>
              ))}
            </div>
            <div className="mt-3 flex gap-2">
              <button
                className="rounded bg-[#c4d45a] px-3 py-1 text-sm text-[#16180f]"
                onClick={() => {
                  applySelectedModels(selectedRemote, remoteModels);
                  pushToast("info", `已应用 ${selectedRemote.size} 个模型`);
                }}
              >
                应用所选模型
              </button>
              <button className="rounded border border-[#33392a] px-3 py-1 text-sm" onClick={closeModelPicker}>
                关闭
              </button>
            </div>
          </div>
        )}

        <div className="mt-3 flex gap-2">
          <button
            className="rounded-lg bg-[#c4d45a] px-3 py-1.5 text-sm text-[#16180f]"
            onClick={() => {
              if (!providerId.trim()) {
                pushToast("error", "请填写提供商 ID");
                return;
              }
              const providers = { ...(file.providers ?? {}) };
              if (editingId && editingId !== providerId) delete providers[editingId];
              providers[providerId.trim()] = draft;
              void save({ ...file, providers }).then(() => {
                setEditingId(providerId.trim());
              });
            }}
          >
            {editingId ? "保存修改" : "写入 models.json"}
          </button>
          {editingId && (
            <button className="rounded-lg border border-[#33392a] px-3 py-1.5 text-sm" onClick={resetForm}>
              取消编辑
            </button>
          )}
        </div>
      </div>

      <div className="mb-6 rounded-xl border border-[#33392a] bg-[#1a1d16] p-4">
        <h2 className="mb-3 font-medium">已写入的自定义提供商</h2>
        {customProviders.length === 0 ? (
          <div className="text-sm text-[#9a937c]">还没有自定义提供商</div>
        ) : (
          <div className="grid gap-2">
            {customProviders.map(([id, provider]) => (
              <div key={id} className="flex items-center justify-between gap-3 rounded border border-[#33392a] px-3 py-2 text-sm">
                <div className="min-w-0">
                  <div className="font-medium">{id}</div>
                  <div className="truncate text-xs text-[#9a937c]">
                    {provider.api ?? "openai-completions"} · {provider.baseUrl || "无 URL"} · {(provider.models ?? []).map((model) => model.id).join(", ") || "无模型"}
                  </div>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button className="rounded border border-[#33392a] px-2 py-1 text-xs" onClick={() => startEdit(id, provider)}>
                    修改
                  </button>
                  <button
                    className="rounded border border-[#33392a] px-2 py-1 text-xs"
                    onClick={() => {
                      const providers = { ...(file.providers ?? {}) };
                      delete providers[id];
                      if (editingId === id) resetForm();
                      void save({ ...file, providers });
                    }}
                  >
                    删除
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-[#33392a] bg-[#1a1d16] p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-medium">高级 JSON</h2>
          <button className="text-xs text-[#c4d45a]" onClick={() => setRawMode((value) => !value)}>
            {rawMode ? "收起" : "展开"}
          </button>
        </div>
        {rawMode && (
          <div>
            <textarea className="h-64 w-full rounded border border-[#33392a] bg-[#12140f] p-2 font-mono text-xs" value={raw} onChange={(e) => setRaw(e.target.value)} />
            <button
              className="mt-2 rounded bg-[#c4d45a] px-3 py-1 text-sm text-[#16180f]"
              onClick={() => {
                try {
                  void save(JSON.parse(raw) as ModelsFile);
                } catch (error) {
                  pushToast("error", error instanceof Error ? error.message : String(error));
                }
              }}
            >
              保存 JSON
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
