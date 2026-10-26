import { Files, Monitor, Moon, Palette, PlugsConnected, ShieldCheck, SlidersHorizontal, Sun, Trash } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import type { DesktopSettings, ResourceCreateScope, ResourceFile, ResourceFiles, ThemeMode } from "@shared/types";
import { refreshModelsAndSessions, useAppStore } from "../stores/app-store";
import { McpSettingsPanel } from "./mcp/McpSettingsPanel";
import {
  Badge,
  Button,
  EmptyState,
  Field,
  IconButton,
  PageBody,
  PageHeader,
  PageShell,
  SectionCard,
  SegmentedControl,
  SkeletonCards,
  SkeletonList,
  Switch,
  cx,
  inputClass,
  textareaClass,
} from "./ui";

const THEME_OPTIONS: Array<{ id: ThemeMode; label: string; hint: string; icon: typeof Sun }> = [
  { id: "dark", label: "深色", hint: "固定使用深色界面", icon: Moon },
  { id: "light", label: "浅色", hint: "固定使用浅色界面", icon: Sun },
  { id: "system", label: "跟随系统", hint: "随操作系统外观自动切换", icon: Monitor },
];

type SettingsGroup = "appearance" | "behavior" | "project" | "mcp" | "resources";

const GROUPS: Array<{ id: SettingsGroup; label: string; icon: typeof Palette }> = [
  { id: "appearance", label: "外观", icon: Palette },
  { id: "behavior", label: "行为", icon: SlidersHorizontal },
  { id: "project", label: "项目与权限", icon: ShieldCheck },
  { id: "mcp", label: "MCP", icon: PlugsConnected },
  { id: "resources", label: "资源文件", icon: Files },
];

/**
 * 设置页。
 *
 * 信息架构：左侧分组导航 + 右侧内容区（审计 S6-1），并按「即时生效 / 需保存」分区（S6-2）。
 * 即改即生效的设置（外观）不提供保存按钮；需保存的设置集中在「行为」分组内，并提供未保存提示。
 */
export function SettingsPage() {
  const snapshot = useAppStore((state) => state.snapshot);
  const settings = useAppStore((state) => state.settings);
  const theme = useAppStore((state) => state.theme);
  const setTheme = useAppStore((state) => state.setTheme);
  const appVersion = useAppStore((state) => state.appVersion);
  const [draft, setDraft] = useState<DesktopSettings>(settings);
  const [rules, setRules] = useState<string[]>([]);
  const [rulesLoading, setRulesLoading] = useState(true);
  const [filesLoading, setFilesLoading] = useState(true);
  const [resourceFiles, setResourceFiles] = useState<ResourceFiles>({ prompts: [], agentsFiles: [] });
  const [group, setGroup] = useState<SettingsGroup>("appearance");
  const pushToast = useAppStore((state) => state.pushToast);

  useEffect(() => {
    setDraft(settings);
  }, [settings]);

  useEffect(() => {
    void window.pi
      .listPermissionRules()
      .then((list) => setRules(list as string[]))
      .catch(() => undefined)
      .finally(() => setRulesLoading(false));
  }, []);

  useEffect(() => {
    setFilesLoading(true);
    void window.pi
      .getResourceFiles()
      .then((files) => setResourceFiles(files as ResourceFiles))
      .catch(() => undefined)
      .finally(() => setFilesLoading(false));
  }, [snapshot?.cwd, snapshot?.sessionId]);

  const dirty =
    draft.hideThinkingBlock !== settings.hideThinkingBlock ||
    draft.compactionEnabled !== settings.compactionEnabled ||
    draft.retryEnabled !== settings.retryEnabled;

  const save = async () => {
    await window.pi.updateSettings(draft);
    await refreshModelsAndSessions();
    pushToast("info", "设置已保存");
  };

  return (
    <PageShell>
      <PageHeader
        title="设置"
        description="外观仅保存在桌面端；行为与权限写入 ~/.pi/agent，与 CLI 共用。"
        badge={appVersion ? <Badge>v{appVersion}</Badge> : undefined}
      />

      <div className="grid gap-6 lg:grid-cols-[168px_minmax(0,1fr)]">
        <nav aria-label="设置分组" className="flex flex-col gap-0.5 lg:sticky lg:top-5 lg:self-start">
          {GROUPS.map((item) => {
            const Icon = item.icon;
            const active = group === item.id;
            return (
              <button
                key={item.id}
                type="button"
                aria-current={active ? "page" : undefined}
                onClick={() => setGroup(item.id)}
                className={cx(
                  "flex h-8 items-center gap-2 rounded-control px-2.5 text-sm transition-colors duration-[var(--motion-instant)]",
                  active
                    ? "bg-accent-fill font-medium text-on-accent"
                    : "text-ink-soft hover:bg-surface-raised hover:text-ink",
                )}
              >
                <Icon size={15} className="shrink-0" />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </nav>

        <PageBody>
          {group === "appearance" && (
            <SectionCard
              headingLevel={2}
              title="外观"
              description="立即生效，不需要保存。仅影响桌面界面，不修改 pi CLI 的主题设置。"
            >
              <SegmentedControl
                ariaLabel="界面外观"
                options={THEME_OPTIONS.map((option) => ({
                  id: option.id,
                  label: option.label,
                  hint: option.hint,
                  icon: <option.icon size={15} />,
                }))}
                value={theme}
                onChange={(next) => setTheme(next)}
              />
            </SectionCard>
          )}

          {group === "behavior" && (
            <SectionCard
              headingLevel={2}
              title="行为"
              description="修改后需要保存，保存立即生效，无需重启。"
              footer={
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs text-ink-muted">
                    {dirty ? "有未保存的更改" : "已与 ~/.pi/agent/settings.json 同步"}
                  </span>
                  <div className="flex items-center gap-2">
                    <Button disabled={!dirty} onClick={() => setDraft(settings)}>
                      放弃更改
                    </Button>
                    <Button variant="primary" disabled={!dirty} onClick={() => void save()}>
                      保存更改
                    </Button>
                  </div>
                </div>
              }
            >
              <ul className="flex flex-col divide-y divide-line-subtle">
                <SettingRow
                  label="隐藏思考块"
                  hint="对话中不显示模型的思考过程，仅保留最终回答。"
                  checked={Boolean(draft.hideThinkingBlock)}
                  onChange={(next) => setDraft({ ...draft, hideThinkingBlock: next })}
                />
                <SettingRow
                  label="自动压缩"
                  hint="上下文接近上限时自动压缩历史消息，压缩摘要会保留在会话中。"
                  checked={draft.compactionEnabled !== false}
                  onChange={(next) => setDraft({ ...draft, compactionEnabled: next })}
                />
                <SettingRow
                  label="自动重试"
                  hint="请求失败时按退避策略自动重试，连续失败达到上限后停止。"
                  checked={draft.retryEnabled !== false}
                  onChange={(next) => setDraft({ ...draft, retryEnabled: next })}
                />
              </ul>
            </SectionCard>
          )}

          {group === "project" && (
            <>
              <SectionCard
                headingLevel={2}
                title="项目信任"
                description="信任后，该项目目录下的工具调用不再逐次确认；密钥与凭据文件仍然禁止访问。"
                actions={
                  <Badge tone={snapshot?.projectTrusted ? "success" : "warning"}>
                    {snapshot?.projectTrusted ? "已信任" : "未信任"}
                  </Badge>
                }
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="primary" disabled={snapshot?.projectTrusted} onClick={() => void window.pi.trustProject(true)}>
                    信任此目录
                  </Button>
                  <Button onClick={() => void window.pi.trustProject(true, true)}>信任父目录</Button>
                  <Button variant="danger" disabled={!snapshot?.projectTrusted} onClick={() => void window.pi.trustProject(false)}>
                    取消信任
                  </Button>
                </div>
                <p className="mt-3 truncate text-xs text-ink-muted" title={snapshot?.cwd}>
                  当前目录：{snapshot?.cwd ?? "未打开项目"}
                </p>
              </SectionCard>

              <SectionCard
                headingLevel={2}
                title="已记住的权限规则"
                description="「始终允许」的高风险命令保存在 ~/.pi/agent/desktop-permissions.json。"
                actions={
                  rules.length > 0 ? (
                    <Button size="sm" onClick={async () => setRules((await window.pi.clearPermissionRules()) as string[])}>
                      全部清除
                    </Button>
                  ) : undefined
                }
              >
                {rulesLoading ? (
                  <SkeletonList rows={2} />
                ) : rules.length === 0 ? (
                  <EmptyState
                    compact
                    title="还没有记住的规则"
                    description="在工具确认框中选择「始终允许」后，规则会出现在这里，可随时撤销。"
                  />
                ) : (
                  <ul className="flex flex-col gap-1">
                    {rules.map((rule) => (
                      <li
                        key={rule}
                        className="flex items-center justify-between gap-2 rounded-control border border-line px-2 py-1 text-xs"
                      >
                        <span className="min-w-0 flex-1 truncate font-mono text-ink-soft" title={rule}>
                          {rule}
                        </span>
                        <IconButton
                          size="sm"
                          variant="danger"
                          label={`移除规则 ${rule}`}
                          onClick={async () => {
                            const next = (await window.pi.forgetPermissionRule(rule)) as string[];
                            setRules(next);
                          }}
                        >
                          <Trash size={13} />
                        </IconButton>
                      </li>
                    ))}
                  </ul>
                )}
              </SectionCard>
            </>
          )}

          {group === "mcp" && <McpSettingsPanel />}

          {group === "resources" && (
            filesLoading ? (
              <SkeletonCards count={2} />
            ) : (
            <div className="grid gap-4 xl:grid-cols-2">
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
            )
          )}
        </PageBody>
      </div>
    </PageShell>
  );
}

/** 需要保存的设置行：可见标签 + 说明 + 开关。 */
function SettingRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  const id = `setting-${label}`;
  return (
    <li className="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <label htmlFor={id} className="text-sm font-medium text-ink">
          {label}
        </label>
        <p id={`${id}-hint`} className="mt-0.5 text-xs text-ink-muted">
          {hint}
        </p>
      </div>
      <Switch id={id} checked={checked} onChange={onChange} label={label} />
    </li>
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
    <SectionCard
      headingLevel={3}
      title={title}
      description={note}
      actions={
        <Button
          size="sm"
          disabled={!hasProject}
          title={hasProject ? undefined : "请先打开项目目录"}
          onClick={() => setCreating((current) => !current)}
        >
          {creating ? "取消新建" : "新建"}
        </Button>
      }
    >
      {creating && (
        <div className="mb-3 flex flex-col gap-2 rounded-control bg-surface-muted px-3 py-2">
          {kind === "prompt" && (
            <>
              <Field label="模板名称" htmlFor={`${kind}-new-name`} hint="保存为 <名称>.md，输入时用 /名称 触发。">
                <input
                  id={`${kind}-new-name`}
                  className={inputClass}
                  placeholder="例如 review"
                  value={newName}
                  onChange={(event) => setNewName(event.target.value)}
                />
              </Field>
              <Field label="描述（可选）" htmlFor={`${kind}-new-description`}>
                <input
                  id={`${kind}-new-description`}
                  className={inputClass}
                  placeholder="一句话说明这个模板做什么"
                  value={newDescription}
                  onChange={(event) => setNewDescription(event.target.value)}
                />
              </Field>
            </>
          )}
          {kind === "agents" && <p className="text-xs text-ink-muted">将创建 AGENTS.md，保存后可继续编辑内容。</p>}
          {hasProject && (
            <fieldset className="flex gap-4 text-xs">
              <legend className="mb-1 text-xs font-medium text-ink-soft">创建位置</legend>
              <label className="flex items-center gap-1.5 text-ink">
                <input type="radio" checked={newScope === "project"} onChange={() => setNewScope("project")} />
                当前项目
              </label>
              <label className="flex items-center gap-1.5 text-ink">
                <input type="radio" checked={newScope === "user"} onChange={() => setNewScope("user")} />
                全局
              </label>
            </fieldset>
          )}
          <div>
            <Button
              size="sm"
              variant="primary"
              disabled={creatingBusy || (kind === "prompt" && !newName.trim())}
              onClick={() => void createFile()}
            >
              {creatingBusy ? "创建中…" : kind === "prompt" ? "创建模板" : "创建 AGENTS.md"}
            </Button>
          </div>
        </div>
      )}

      {items.length === 0 && !creating ? (
        <EmptyState
          compact
          title={kind === "prompt" ? "还没有提示模板" : "还没有上下文文件"}
          description={
            hasProject
              ? "点右上角「新建」创建第一个文件。"
              : "打开项目目录后才能创建项目级文件。"
          }
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((item, index) => {
            const open = openPath === item.path;
            const draft = drafts[item.path] ?? { content: item.content, description: item.description ?? "" };
            return (
              <li key={item.path} className="border-b border-line-subtle last:border-b-0">
                <button
                  type="button"
                  aria-expanded={open}
                  className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm"
                  onClick={() => setOpenPath(open ? null : item.path)}
                >
                  <span className="min-w-0 truncate text-ink">{item.name}</span>
                  <span className="shrink-0 text-2xs text-ink-muted">{open ? "收起" : "展开"}</span>
                </button>
                {open && (
                  <div className="flex flex-col gap-2 border-t border-line-subtle px-3 py-2">
                    <div className="truncate font-mono text-2xs text-ink-muted" title={item.path}>
                      {item.path}
                    </div>
                    {item.kind === "prompt" && (
                      <Field label="描述" htmlFor={`${kind}-${index}-description`}>
                        <input
                          id={`${kind}-${index}-description`}
                          className={inputClass}
                          placeholder="描述"
                          value={draft.description}
                          onChange={(event) =>
                            setDrafts((current) => ({
                              ...current,
                              [item.path]: { ...draft, description: event.target.value },
                            }))
                          }
                        />
                      </Field>
                    )}
                    <Field label="内容" htmlFor={`${kind}-${index}-content`}>
                      <textarea
                        id={`${kind}-${index}-content`}
                        className={cx(textareaClass, "h-48 font-mono text-xs leading-5")}
                        value={draft.content}
                        onChange={(event) =>
                          setDrafts((current) => ({
                            ...current,
                            [item.path]: { ...draft, content: event.target.value },
                          }))
                        }
                      />
                    </Field>
                    {item.truncated && (
                      <div className="text-2xs text-danger">内容过长，已截断显示，保存会覆盖为当前编辑内容。</div>
                    )}
                    <div>
                      <Button
                        size="sm"
                        variant="primary"
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
                      </Button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </SectionCard>
  );
}
