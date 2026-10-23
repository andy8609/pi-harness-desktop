import { Monitor, Moon, Sun } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import type { DesktopSettings, ResourceCreateScope, ResourceFile, ResourceFiles, ThemeMode } from "@shared/types";
import { refreshModelsAndSessions, useAppStore } from "../stores/app-store";

const THEME_OPTIONS: Array<{ id: ThemeMode; label: string; note: string; icon: typeof Sun }> = [
  { id: "dark", label: "深色", note: "固定使用深色界面", icon: Moon },
  { id: "light", label: "浅色", note: "固定使用浅色界面", icon: Sun },
  { id: "system", label: "跟随系统", note: "随操作系统外观自动切换", icon: Monitor },
];

export function SettingsPage() {
  const snapshot = useAppStore((state) => state.snapshot);
  const settings = useAppStore((state) => state.settings);
  const theme = useAppStore((state) => state.theme);
  const setTheme = useAppStore((state) => state.setTheme);
  const appVersion = useAppStore((state) => state.appVersion);
  const [draft, setDraft] = useState<DesktopSettings>(settings);
  const [rules, setRules] = useState<string[]>([]);
  const [resourceFiles, setResourceFiles] = useState<ResourceFiles>({ prompts: [], agentsFiles: [] });
  const pushToast = useAppStore((state) => state.pushToast);

  useEffect(() => {
    setDraft(settings);
  }, [settings]);

  useEffect(() => {
    void window.pi
      .listPermissionRules()
      .then((list) => setRules(list as string[]))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    void window.pi
      .getResourceFiles()
      .then((files) => setResourceFiles(files as ResourceFiles))
      .catch(() => undefined);
  }, [snapshot?.cwd, snapshot?.sessionId]);

  return (
    <section className="h-full overflow-auto px-6 py-5">
      <h1 className="text-xl font-semibold">
        设置
        {appVersion && (
          <span className="ml-2 rounded border border-[var(--line)] px-1.5 py-0.5 align-middle text-xs font-normal text-[var(--muted)]">
            v{appVersion}
          </span>
        )}
      </h1>
      <p className="mt-1 mb-6 text-sm text-[var(--muted)]">外观仅保存在桌面端；下方设置写入 ~/.pi/agent/settings.json，与 CLI 共用。</p>

      <div className="mb-6">
        <h2 className="mb-2 font-medium">外观</h2>
        <div className="mb-2 text-xs text-[var(--muted)]">仅影响桌面界面外观，不会修改 pi CLI 的主题设置。</div>
        <div className="inline-flex max-w-xl flex-wrap items-center gap-1 rounded-xl border border-[var(--line)] bg-[var(--bg-raised)] p-1">
          {THEME_OPTIONS.map((option) => {
            const active = theme === option.id;
            const Icon = option.icon;
            return (
              <button
                key={option.id}
                type="button"
                title={option.note}
                aria-pressed={active}
                className={`flex items-center gap-2 rounded-lg px-4 py-1.5 text-sm transition-colors ${
                  active
                    ? "bg-[var(--accent-bg)] font-medium text-[var(--on-accent)] shadow-sm"
                    : "text-[var(--text-soft)] hover:bg-[var(--bg-panel)] hover:text-[var(--text)]"
                }`}
                onClick={() => setTheme(option.id)}
              >
                <Icon size={15} weight={active ? "fill" : "regular"} />
                {option.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mb-6 grid max-w-xl gap-3">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={Boolean(draft.hideThinkingBlock)}
            onChange={(e) => setDraft({ ...draft, hideThinkingBlock: e.target.checked })}
          />
          隐藏思考块
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={draft.compactionEnabled !== false}
            onChange={(e) => setDraft({ ...draft, compactionEnabled: e.target.checked })}
          />
          自动压缩
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={draft.retryEnabled !== false}
            onChange={(e) => setDraft({ ...draft, retryEnabled: e.target.checked })}
          />
          自动重试
        </label>
        <button
          className="w-fit rounded-lg bg-[var(--accent-bg)] px-3 py-1.5 text-sm text-[var(--on-accent)]"
          onClick={async () => {
            await window.pi.updateSettings(draft);
            await refreshModelsAndSessions();
            pushToast("info", "设置已保存");
          }}
        >
          保存设置
        </button>
      </div>

      <div className="mb-6">
        <h2 className="mb-2 font-medium">项目信任</h2>
        <div className="mb-2 text-sm text-[var(--muted)]">当前：{snapshot?.projectTrusted ? "已信任" : "未信任"}</div>
        <div className="flex gap-2">
          <button className="rounded border border-[var(--line)] px-3 py-1 text-sm" onClick={() => window.pi.trustProject(true)}>
            信任此目录
          </button>
          <button className="rounded border border-[var(--line)] px-3 py-1 text-sm" onClick={() => window.pi.trustProject(true, true)}>
            信任父目录
          </button>
          <button className="rounded border border-[var(--line)] px-3 py-1 text-sm" onClick={() => window.pi.trustProject(false)}>
            取消信任
          </button>
        </div>
      </div>

      <div className="mb-6">
        <h2 className="mb-2 font-medium">已记住的权限规则</h2>
        <p className="mb-2 text-xs text-[var(--muted)]">
          「始终允许」的高风险命令保存在 ~/.pi/agent/desktop-permissions.json。
        </p>
        {rules.length === 0 ? (
          <div className="text-sm text-[var(--muted)]">暂无</div>
        ) : (
          <ul className="max-w-2xl space-y-1">
            {rules.map((rule) => (
              <li
                key={rule}
                className="flex items-center justify-between gap-2 rounded border border-[var(--line)] px-2 py-1 text-xs"
              >
                <span className="min-w-0 flex-1 truncate font-mono">{rule}</span>
                <button
                  className="shrink-0 text-[var(--danger)]"
                  onClick={async () => {
                    const next = (await window.pi.forgetPermissionRule(rule)) as string[];
                    setRules(next);
                  }}
                >
                  移除
                </button>
              </li>
            ))}
          </ul>
        )}
        {rules.length > 0 && (
          <button
            className="mt-2 rounded border border-[var(--line)] px-2 py-1 text-xs"
            onClick={async () => setRules((await window.pi.clearPermissionRules()) as string[])}
          >
            全部清除
          </button>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ResourceEditor
          key={`prompts-${snapshot?.cwd ?? "none"}`}
          kind="prompt"
          title="提示模板"
          note="来自 ~/.pi/agent/prompts 与项目 .pi/prompts。没有文件时可新建。"
          items={resourceFiles.prompts}
          hasProject={Boolean(snapshot?.cwd)}
          onSaved={setResourceFiles}
        />
        <ResourceEditor
          key={`agents-${snapshot?.cwd ?? "none"}`}
          kind="agents"
          title="上下文文件"
          note="当前加载的 AGENTS.md 等上下文文件。没有文件时可新建项目或全局 AGENTS.md。"
          items={resourceFiles.agentsFiles}
          hasProject={Boolean(snapshot?.cwd)}
          onSaved={setResourceFiles}
        />
      </div>
    </section>
  );
}

function ResourceEditor({
  kind,
  title,
  note,
  items,
  hasProject,
  onSaved,
}: {
  kind: ResourceFile["kind"];
  title: string;
  note: string;
  items: ResourceFile[];
  hasProject: boolean;
  onSaved: (files: ResourceFiles) => void;
}) {
  const pushToast = useAppStore((state) => state.pushToast);
  const [openPath, setOpenPath] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, { content: string; description: string }>>({});
  const [savingPath, setSavingPath] = useState<string | null>(null);
  const [creating, setCreating] = useState(items.length === 0 && hasProject);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newScope, setNewScope] = useState<ResourceCreateScope>(hasProject ? "project" : "user");
  const [creatingBusy, setCreatingBusy] = useState(false);

  useEffect(() => {
    setDrafts(
      Object.fromEntries(items.map((item) => [item.path, { content: item.content, description: item.description ?? "" }])),
    );
  }, [items]);

  const createFile = async () => {
    setCreatingBusy(true);
    try {
      const next = (await window.pi.createResourceFile({
        kind,
        scope: hasProject ? newScope : "user",
        name: kind === "prompt" ? newName : undefined,
        description: kind === "prompt" ? newDescription : undefined,
      })) as ResourceFiles;
      onSaved(next);
      const created = (kind === "prompt" ? next.prompts : next.agentsFiles).find((item) =>
        kind === "prompt" ? item.name === newName.trim().replace(/\.md$/i, "") : item.name.toLowerCase() === "agents.md",
      );
      if (created) setOpenPath(created.path);
      setCreating(false);
      setNewName("");
      setNewDescription("");
      pushToast("info", kind === "prompt" ? "已新建提示模板" : "已新建上下文文件");
    } catch (error) {
      pushToast("error", error instanceof Error ? error.message : String(error));
    } finally {
      setCreatingBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-[var(--line)] bg-[var(--bg-panel)] p-4">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h3 className="font-medium">{title}</h3>
        <button
          type="button"
          className="rounded border border-[var(--line)] px-2 py-0.5 text-xs text-[var(--accent)] hover:border-[var(--accent)] disabled:opacity-50"
          disabled={!hasProject}
          title={hasProject ? undefined : "请先打开项目目录"}
          onClick={() => setCreating((current) => !current)}
        >
          {creating ? "取消" : "新建"}
        </button>
      </div>
      <p className="mb-3 text-xs text-[var(--muted)]">{note}</p>
      {creating && (
        <div className="mb-3 space-y-2 rounded-lg border border-[var(--line)] px-3 py-2">
          {kind === "prompt" && (
            <>
              <input
                className="w-full rounded border border-[var(--line)] bg-[var(--bg)] px-2 py-1 text-xs"
                placeholder="模板名称，例如 review"
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
              />
              <input
                className="w-full rounded border border-[var(--line)] bg-[var(--bg)] px-2 py-1 text-xs"
                placeholder="描述（可选）"
                value={newDescription}
                onChange={(event) => setNewDescription(event.target.value)}
              />
            </>
          )}
          {kind === "agents" && <div className="text-xs text-[var(--muted)]">将创建 AGENTS.md，保存后可继续编辑内容。</div>}
          {hasProject && (
            <div className="flex gap-3 text-xs">
              <label className="flex items-center gap-1">
                <input type="radio" checked={newScope === "project"} onChange={() => setNewScope("project")} />
                当前项目
              </label>
              <label className="flex items-center gap-1">
                <input type="radio" checked={newScope === "user"} onChange={() => setNewScope("user")} />
                全局
              </label>
            </div>
          )}
          <button
            type="button"
            className="rounded bg-[var(--accent-bg)] px-2 py-1 text-xs text-[var(--on-accent)] disabled:opacity-50"
            disabled={creatingBusy || (kind === "prompt" && !newName.trim())}
            onClick={() => void createFile()}
          >
            {creatingBusy ? "创建中…" : kind === "prompt" ? "创建模板" : "创建 AGENTS.md"}
          </button>
        </div>
      )}
      {items.length === 0 && !creating ? (
        <div className="text-sm text-[var(--muted)]">暂无文件，点击右上角「新建」。</div>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => {
            const open = openPath === item.path;
            const draft = drafts[item.path] ?? { content: item.content, description: item.description ?? "" };
            return (
              <li key={item.path} className="rounded-lg border border-[var(--line)]">
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm"
                  onClick={() => setOpenPath(open ? null : item.path)}
                >
                  <span className="min-w-0 truncate">{item.name}</span>
                  <span className="shrink-0 text-[11px] text-[var(--muted)]">{open ? "收起" : "展开"}</span>
                </button>
                {open && (
                  <div className="space-y-2 border-t border-[var(--line)] px-3 py-2">
                    <div className="truncate font-mono text-[11px] text-[var(--muted)]" title={item.path}>
                      {item.path}
                    </div>
                    {item.kind === "prompt" && (
                      <input
                        className="w-full rounded border border-[var(--line)] bg-[var(--bg)] px-2 py-1 text-xs"
                        placeholder="描述"
                        value={draft.description}
                        onChange={(event) =>
                          setDrafts((current) => ({
                            ...current,
                            [item.path]: { ...draft, description: event.target.value },
                          }))
                        }
                      />
                    )}
                    <textarea
                      className="h-48 w-full resize-y rounded border border-[var(--line)] bg-[var(--bg)] px-2 py-1 font-mono text-xs leading-5"
                      value={draft.content}
                      onChange={(event) =>
                        setDrafts((current) => ({
                          ...current,
                          [item.path]: { ...draft, content: event.target.value },
                        }))
                      }
                    />
                    {item.truncated && <div className="text-[11px] text-[var(--danger)]">内容过长，已截断显示，保存会覆盖为当前编辑内容。</div>}
                    <button
                      type="button"
                      className="rounded bg-[var(--accent-bg)] px-2 py-1 text-xs text-[var(--on-accent)] disabled:opacity-50"
                      disabled={savingPath === item.path}
                      onClick={async () => {
                        setSavingPath(item.path);
                        try {
                          const next = (await window.pi.saveResourceFile(
                            item.kind,
                            item.path,
                            draft.content,
                            item.kind === "prompt" ? draft.description : undefined,
                          )) as ResourceFiles;
                          onSaved(next);
                          pushToast("info", `已保存 ${item.name}`);
                        } catch (error) {
                          pushToast("error", error instanceof Error ? error.message : String(error));
                        } finally {
                          setSavingPath(null);
                        }
                      }}
                    >
                      {savingPath === item.path ? "保存中…" : "保存"}
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
