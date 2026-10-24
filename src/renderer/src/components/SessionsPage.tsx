import { useEffect, useMemo, useState } from "react";
import { Plus, TreeStructure, Trash } from "@phosphor-icons/react";
import type { SessionListItem, TreeNode } from "@shared/types";
import { buildTree } from "../lib/tree";
import { formatTime } from "../lib/text";
import { refreshModelsAndSessions, useAppStore } from "../stores/app-store";
import { SessionTree } from "./SessionTree";
import {
  Badge,
  Button,
  EmptyState,
  Field,
  IconButton,
  PageFrame,
  PageHeader,
  SkeletonList,
  cx,
  inputClass,
} from "./ui";

function sessionTitle(session: { name?: string; firstMessage: string; id: string }): string {
  return session.name || session.firstMessage.slice(0, 40) || session.id.slice(0, 8);
}

/**
 * 会话页。
 *
 * 信息架构：页头（标题 + 会话级操作）→ 操作条（重命名 / 复制分支 / 压缩两组）→ 主区（会话列表 | 会话树）。
 * 改造前 9 个控件分两行平铺、会话卡片靠双击还原、无搜索无加载态（审计 S2-1~S2-8）。
 */
export function SessionsPage() {
  const sessions = useAppStore((state) => state.sessions);
  const snapshot = useAppStore((state) => state.snapshot);
  const applySnapshot = useAppStore((state) => state.applySnapshot);
  const pushToast = useAppStore((state) => state.pushToast);
  const setView = useAppStore((state) => state.setView);
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [treeError, setTreeError] = useState<string>();
  const [treeLoading, setTreeLoading] = useState(true);
  const [listLoading, setListLoading] = useState(true);
  const [name, setName] = useState("");
  const [compactHint, setCompactHint] = useState("");
  const [search, setSearch] = useState("");
  const [selectedPath, setSelectedPath] = useState<string>();
  const [deleteConfirmPath, setDeleteConfirmPath] = useState<string | null>(null);

  const currentPath = snapshot?.sessionFile;
  const previewPath = selectedPath ?? currentPath;

  const loadTree = async (path?: string) => {
    setTreeLoading(true);
    try {
      setTreeError(undefined);
      const flat = await window.pi.getTree(path);
      setTree(buildTree(flat));
    } catch (error) {
      setTree([]);
      const message = error instanceof Error ? error.message : String(error);
      setTreeError(message);
      pushToast("error", `加载会话树失败：${message}`);
    } finally {
      setTreeLoading(false);
    }
  };

  useEffect(() => {
    void refreshModelsAndSessions().finally(() => setListLoading(false));
  }, []);

  useEffect(() => {
    void loadTree(previewPath);
  }, [previewPath]);

  // 两段式删除确认：3 秒内未确认自动复位（与模型页删除交互一致，审计 S8-4）
  useEffect(() => {
    if (!deleteConfirmPath) return;
    const timer = setTimeout(() => setDeleteConfirmPath(null), 3000);
    return () => clearTimeout(timer);
  }, [deleteConfirmPath]);

  const restoreSession = async (path: string) => {
    applySnapshot(await window.pi.switchSession(path));
    await refreshModelsAndSessions();
    setSelectedPath(path);
    setView("chat");
  };

  const activatePreviewSession = async () => {
    if (previewPath && previewPath !== currentPath) {
      applySnapshot(await window.pi.switchSession(previewPath));
      setSelectedPath(previewPath);
    }
  };

  const deleteSession = async (session: SessionListItem) => {
    const deletingCurrent = currentPath === session.path;
    try {
      await window.pi.deleteSession(session.path);
      if (deletingCurrent) applySnapshot(await window.pi.getState());
      await refreshModelsAndSessions();
      if (selectedPath === session.path) setSelectedPath(undefined);
      pushToast("info", "已删除会话");
    } catch (error) {
      pushToast("error", error instanceof Error ? error.message : String(error));
    }
  };

  /** 当前会话置顶，其余按修改时间倒序；再按搜索词过滤（S2-5）。 */
  const visibleSessions = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return [...sessions]
      .sort((a, b) => {
        if (a.path === currentPath) return -1;
        if (b.path === currentPath) return 1;
        return new Date(b.modified).getTime() - new Date(a.modified).getTime();
      })
      .filter((session) => (needle ? sessionTitle(session).toLowerCase().includes(needle) : true));
  }, [sessions, currentPath, search]);

  return (
    <PageFrame>
      <PageHeader
        className="pt-5"
        title="会话"
        description="选中左侧会话可预览其会话树；「还原」把该会话恢复到对话窗口。"
        actions={
          <>
            <Button
              size="sm"
              variant="primary"
              icon={<Plus size={13} />}
              onClick={async () => {
                applySnapshot(await window.pi.newSession());
                await refreshModelsAndSessions();
                setView("chat");
              }}
            >
              新建会话
            </Button>
            <div className="flex items-center gap-1 border-l border-line pl-2">
              <Button
                size="sm"
                onClick={async () => {
                  const next = await window.pi.importJsonl();
                  if (next) {
                    applySnapshot(next);
                    await refreshModelsAndSessions();
                    setView("chat");
                  }
                }}
              >
                导入
              </Button>
              <Button size="sm" variant="ghost" onClick={() => void window.pi.exportJsonl()}>
                导出 JSONL
              </Button>
              <Button size="sm" variant="ghost" onClick={() => void window.pi.exportHtml()}>
                导出 HTML
              </Button>
            </div>
          </>
        }
      />

      <div className="mb-4 grid shrink-0 gap-3 rounded-panel border border-line bg-surface p-3 xl:grid-cols-2">
        <div className="flex flex-col gap-1 xl:justify-between">
          <div className="flex flex-wrap items-end gap-2">
            <Field label="会话名称" htmlFor="session-name" className="min-w-0 flex-1">
              <input
                id="session-name"
                className={inputClass}
                placeholder="留空则保持原标题"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </Field>
            <Button
              disabled={!name.trim()}
              onClick={async () => {
                if (!name.trim()) return;
                await window.pi.nameSession(name.trim());
                await refreshModelsAndSessions();
                pushToast("info", "会话已重命名");
              }}
            >
              重命名
            </Button>
          </div>
          <p className="text-2xs text-ink-muted">重命名只改变显示名称，不影响会话内容与分支。</p>
        </div>
        <div className="flex flex-col gap-1 xl:justify-between">
          <div className="flex flex-wrap items-end gap-2">
            <Field label="压缩说明（可选）" htmlFor="session-compact-hint" className="min-w-0 flex-1">
              <input
                id="session-compact-hint"
                className={inputClass}
                placeholder="例如：切换到新任务"
                value={compactHint}
                onChange={(event) => setCompactHint(event.target.value)}
              />
            </Field>
            <Button
              onClick={async () => {
                await window.pi.compact(compactHint || undefined);
                pushToast("info", "压缩完成");
                await loadTree(previewPath);
              }}
            >
              压缩
            </Button>
            <Button
              onClick={async () => {
                applySnapshot(await window.pi.clone());
                await refreshModelsAndSessions();
                pushToast("info", "已复制当前分支");
              }}
            >
              复制分支
            </Button>
          </div>
          <p className="text-2xs text-ink-muted">压缩会把上下文折成摘要，说明用于标注压缩原因。</p>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 gap-4 pb-5 xl:grid-cols-[minmax(260px,1fr)_minmax(280px,1fr)]">
        <div className="flex min-h-0 flex-col">
          <div className="mb-2 flex shrink-0 items-center gap-2">
            <input
              type="search"
              aria-label="搜索会话"
              className={cx(inputClass, "max-w-xs")}
              placeholder="搜索会话名称"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <span className="text-2xs text-ink-muted">{visibleSessions.length} 个</span>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto pr-1">
            {listLoading ? (
              <SkeletonList rows={4} />
            ) : visibleSessions.length === 0 ? (
              <EmptyState
                compact
                title={search ? "没有匹配的会话" : "当前项目还没有会话"}
                description={search ? "换个关键词，或清空搜索框查看全部会话。" : "新建一个会话开始对话，会话会保存在 ~/.pi/agent。"}
                action={
                  search ? (
                    <Button size="sm" onClick={() => setSearch("")}>
                      清空搜索
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="primary"
                      icon={<Plus size={13} />}
                      onClick={async () => {
                        applySnapshot(await window.pi.newSession());
                        await refreshModelsAndSessions();
                        setView("chat");
                      }}
                    >
                      新建会话
                    </Button>
                  )
                }
              />
            ) : (
              <ul className="flex flex-col gap-2">
                {visibleSessions.map((session) => {
                  const selected = previewPath === session.path;
                  const isCurrent = currentPath === session.path;
                  return (
                    <li
                      key={session.path}
                      className={cx(
                        "rounded-panel border bg-surface",
                        selected ? "border-accent" : "border-line hover:border-accent",
                      )}
                    >
                      <button
                        type="button"
                        aria-pressed={selected}
                        className="flex w-full flex-col gap-1 px-3 py-2.5 text-left"
                        onClick={() => setSelectedPath(session.path)}
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">
                            {sessionTitle(session)}
                          </span>
                          {isCurrent && <Badge tone="accent">当前</Badge>}
                          <span className="shrink-0 text-2xs text-ink-muted">{session.messageCount} 条</span>
                        </span>
                        <span className="text-2xs text-ink-muted">{formatTime(session.modified)}</span>
                      </button>
                      <div className="flex items-center justify-between gap-2 border-t border-line-subtle px-2 py-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={isCurrent}
                          onClick={() => void restoreSession(session.path)}
                        >
                          还原
                        </Button>
                        {deleteConfirmPath === session.path ? (
                          <span className="flex items-center gap-1">
                            <Button
                              size="sm"
                              variant="danger"
                              title={
                                isCurrent ? "删除当前会话，并自动新建一个空会话；不可恢复" : "删除会话，不可恢复"
                              }
                              onClick={() => {
                                setDeleteConfirmPath(null);
                                void deleteSession(session);
                              }}
                            >
                              确认删除
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setDeleteConfirmPath(null)}>
                              取消
                            </Button>
                          </span>
                        ) : (
                          <IconButton
                            size="sm"
                            variant="danger"
                            label={`删除会话 ${sessionTitle(session)}`}
                            onClick={() => setDeleteConfirmPath(session.path)}
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
        </div>

        <div className="flex min-h-0 min-w-0 flex-col">
          <div className="mb-2 shrink-0">
            <h2 className="text-base font-medium text-ink">会话树</h2>
            <p className="mt-0.5 text-2xs text-ink-muted">单击选中节点，双击跳转到对话中的该节点。</p>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {treeLoading ? (
              <SkeletonList rows={3} />
            ) : treeError ? (
              <EmptyState
                compact
                title="会话树加载失败"
                description={treeError}
                action={
                  <Button size="sm" onClick={() => void loadTree(previewPath)}>
                    重试
                  </Button>
                }
              />
            ) : tree.length === 0 ? (
              <EmptyState
                compact
                icon={<TreeStructure size={20} />}
                title="这个会话还没有分支节点"
                description="继续对话后，消息会作为节点出现在这里。"
              />
            ) : (
              <SessionTree
                nodes={tree}
                onNavigate={async (id) => {
                  await activatePreviewSession();
                  applySnapshot(await window.pi.navigateTree(id));
                  await loadTree(previewPath);
                  setView("chat");
                }}
                onFork={async (id) => {
                  await activatePreviewSession();
                  applySnapshot(await window.pi.fork(id));
                  await refreshModelsAndSessions();
                  setView("chat");
                }}
              />
            )}
          </div>
        </div>
      </div>
    </PageFrame>
  );
}
