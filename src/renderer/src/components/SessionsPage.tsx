import { useEffect, useState } from "react";
import { Trash } from "@phosphor-icons/react";
import type { SessionListItem, TreeNode } from "@shared/types";
import { formatTime } from "../lib/text";
import { refreshModelsAndSessions, useAppStore } from "../stores/app-store";
import { SessionTree } from "./SessionTree";

function sessionTitle(session: { name?: string; firstMessage: string; id: string }): string {
  return session.name || session.firstMessage.slice(0, 40) || session.id.slice(0, 8);
}

export function SessionsPage() {
  const sessions = useAppStore((state) => state.sessions);
  const snapshot = useAppStore((state) => state.snapshot);
  const applySnapshot = useAppStore((state) => state.applySnapshot);
  const pushToast = useAppStore((state) => state.pushToast);
  const setView = useAppStore((state) => state.setView);
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [treeError, setTreeError] = useState<string>();
  const [name, setName] = useState("");
  const [compactHint, setCompactHint] = useState("");
  const [selectedPath, setSelectedPath] = useState<string>();

  const currentPath = snapshot?.sessionFile;
  const previewPath = selectedPath ?? currentPath;

  const loadTree = async (path?: string) => {
    try {
      setTreeError(undefined);
      setTree(await window.pi.getTree(path));
    } catch (error) {
      setTree([]);
      const message = error instanceof Error ? error.message : String(error);
      setTreeError(message);
      pushToast("error", `加载会话树失败：${message}`);
    }
  };

  useEffect(() => {
    void refreshModelsAndSessions();
  }, []);

  useEffect(() => {
    void loadTree(previewPath);
  }, [previewPath]);

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
    const confirmed = window.confirm(
      deletingCurrent
        ? `删除当前会话「${sessionTitle(session)}」？\n删除前会自动新建一个空会话，此操作不可恢复。`
        : `确定删除会话「${sessionTitle(session)}」？此操作不可恢复。`,
    );
    if (!confirmed) return;
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

  return (
    <section className="flex h-full min-h-0 flex-col px-6 py-5">
      <div className="mb-4 shrink-0 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">会话</h1>
          <p className="text-sm text-[var(--muted)]">单击预览会话树，双击还原到对话窗口</p>
        </div>
        <div className="flex gap-2">
          <button
            className="rounded-lg bg-[var(--accent-bg)] px-3 py-1.5 text-sm text-[var(--on-accent)]"
            onClick={async () => {
              applySnapshot(await window.pi.newSession());
              await refreshModelsAndSessions();
              setView("chat");
            }}
          >
            新建
          </button>
          <button
            className="rounded-lg border border-[var(--line)] px-3 py-1.5 text-sm"
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
          </button>
          <button className="rounded-lg border border-[var(--line)] px-3 py-1.5 text-sm" onClick={() => void window.pi.exportJsonl()}>
            导出 JSONL
          </button>
          <button className="rounded-lg border border-[var(--line)] px-3 py-1.5 text-sm" onClick={() => void window.pi.exportHtml()}>
            导出 HTML
          </button>
        </div>
      </div>

      <div className="mb-4 shrink-0 flex flex-wrap gap-2">
        <input className="rounded border border-[var(--line)] bg-[var(--bg)] px-2 py-1 text-sm" placeholder="会话名称" value={name} onChange={(e) => setName(e.target.value)} />
        <button
          className="rounded border border-[var(--line)] px-3 py-1 text-sm"
          onClick={async () => {
            if (!name.trim()) return;
            await window.pi.nameSession(name.trim());
            await refreshModelsAndSessions();
          }}
        >
          命名当前会话
        </button>
        <button
          className="rounded border border-[var(--line)] px-3 py-1 text-sm"
          onClick={async () => {
            applySnapshot(await window.pi.clone());
            await refreshModelsAndSessions();
            pushToast("info", "已复制当前分支");
          }}
        >
          Clone
        </button>
        <input className="rounded border border-[var(--line)] bg-[var(--bg)] px-2 py-1 text-sm" placeholder="压缩说明（可选）" value={compactHint} onChange={(e) => setCompactHint(e.target.value)} />
        <button
          className="rounded border border-[var(--line)] px-3 py-1 text-sm"
          onClick={async () => {
            await window.pi.compact(compactHint || undefined);
            pushToast("info", "压缩完成");
            await loadTree(previewPath);
          }}
        >
          Compact
        </button>
      </div>

      <div className="grid min-h-0 flex-1 gap-4 grid-rows-[minmax(140px,36%)_minmax(0,1fr)] lg:grid-rows-1 lg:grid-cols-[minmax(220px,1.1fr)_minmax(280px,0.9fr)]">
        <div className="min-h-0 space-y-2 overflow-auto pr-1">
          {sessions.map((session) => {
            const selected = previewPath === session.path;
            const isCurrent = currentPath === session.path;
            return (
              <div
                key={session.path}
                role="button"
                tabIndex={0}
                className={`block w-full cursor-pointer rounded-xl border px-4 py-3 text-left ${
                  selected ? "border-[var(--accent)] bg-[var(--bg-raised)]" : "border-[var(--line)] bg-[var(--bg-panel)] hover:border-[var(--accent)]"
                }`}
                onClick={() => setSelectedPath(session.path)}
                onDoubleClick={() => void restoreSession(session.path)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") setSelectedPath(session.path);
                }}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 flex-1 truncate font-medium">{sessionTitle(session)}</span>
                  <span className="shrink-0 text-xs text-[var(--muted)]">{session.messageCount} 条</span>
                  <button
                    type="button"
                    title={isCurrent ? "删除当前会话（会自动新建空会话）" : "删除会话"}
                    aria-label="删除会话"
                    className="shrink-0 rounded p-1 text-[var(--muted)] hover:bg-[var(--bg)] hover:text-[var(--danger)]"
                    onClick={(event) => {
                      event.stopPropagation();
                      void deleteSession(session);
                    }}
                  >
                    <Trash size={14} />
                  </button>
                </div>
                <div className="mt-1 flex items-center justify-between gap-2 text-xs text-[var(--muted)]">
                  <span>{formatTime(session.modified)}</span>
                  {isCurrent && <span className="rounded bg-[var(--accent-bg)] px-1.5 py-0.5 text-[10px] text-[var(--on-accent)]">当前</span>}
                </div>
              </div>
            );
          })}
          {sessions.length === 0 && <div className="text-sm text-[var(--muted)]">当前项目还没有会话。</div>}
        </div>
        <div className="flex min-h-0 min-w-0 flex-col">
          <h2 className="mb-1 shrink-0 font-medium">会话树</h2>
          <p className="mb-2 shrink-0 text-xs text-[var(--muted)]">单击选中节点，双击跳转到对话中的该节点</p>
          <div className="min-h-0 flex-1 overflow-auto">
            {treeError ? (
              <div className="rounded-xl border border-[var(--line)] bg-[var(--bg-panel)] p-3 text-sm text-[var(--danger)]">
                会话树加载失败：{treeError}
              </div>
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
    </section>
  );
}
