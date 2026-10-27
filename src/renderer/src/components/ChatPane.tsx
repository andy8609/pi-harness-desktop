import { ArrowsClockwise, ChatTeardropText, FolderOpen, Plus, SidebarSimple, WarningCircle } from "@phosphor-icons/react";
import { Composer } from "./Composer";
import { InlineDialogHost } from "./InlineDialogHost";
import { MessageList } from "./MessageList";
import { MessageQueue } from "./MessageQueue";
import { refreshModelsAndSessions, refreshSessions, useAppStore } from "../stores/app-store";
import { Button, EmptyState, IconButton, Skeleton, SkeletonList } from "./ui";

/**
 * 对话页（主工作区）。
 *
 * 信息架构：页头（会话标识 + 全局操作）→ 提示区（模型回退等）→ 消息流（主）→ 输入区（辅）。
 * 改造前页头用 text-sm 与正文同级、水平内边距与消息区不一致，空态无下一步动作（审计 S1-1/S1-2/S1-5）。
 */
export function ChatPane() {
  const snapshot = useAppStore((state) => state.snapshot);
  const applySnapshot = useAppStore((state) => state.applySnapshot);
  const pushToast = useAppStore((state) => state.pushToast);
  const setView = useAppStore((state) => state.setView);
  const bootstrapped = useAppStore((state) => state.bootstrapped);
  const workPanelOpen = useAppStore((state) => state.workPanel.open);
  const toggleWorkPanel = useAppStore((state) => state.toggleWorkPanel);

  const openDirectory = async () => {
    try {
      const next = await window.pi.openDirectory();
      if (next) {
        applySnapshot(next);
        await refreshModelsAndSessions();
        setView("chat");
      }
    } catch (error) {
      pushToast("error", error instanceof Error ? error.message : String(error));
    }
  };

  if (!bootstrapped) {
    return (
      <div className="flex h-full flex-col gap-4 px-6 py-5" role="status" aria-label="正在加载会话">
        <Skeleton className="h-6 w-48" />
        <SkeletonList rows={3} />
      </div>
    );
  }

  if (!snapshot) {
    return (
      <div className="flex h-full items-center justify-center px-6">
        <EmptyState
          className="w-full max-w-md bg-surface"
          icon={<ChatTeardropText size={24} />}
          title="还没有打开项目"
          description="桌面端只使用官方 SDK 与 ~/.pi/agent，不读取 pi-main 源码。打开一个项目目录后即可开始对话。"
          action={
            <Button variant="primary" icon={<FolderOpen size={14} />} onClick={() => void openDirectory()}>
              打开项目目录
            </Button>
          }
        />
      </div>
    );
  }

  const title = snapshot.displayName || snapshot.sessionName || "未命名会话";

  return (
    <section className="flex h-full min-h-0 flex-col bg-canvas">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-6 py-3">
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold text-ink">{title}</h1>
          <p className="truncate text-xs text-ink-muted" title={snapshot.sessionId}>
            会话 {snapshot.sessionId}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            variant="secondary"
            icon={<Plus size={14} />}
            onClick={async () => {
              applySnapshot(await window.pi.newSession());
              await refreshSessions();
            }}
          >
            新会话
          </Button>
          <Button
            variant="ghost"
            icon={<ArrowsClockwise size={14} />}
            onClick={async () => {
              await window.pi.reload();
              await refreshModelsAndSessions();
              pushToast("info", "已重新加载资源");
            }}
          >
            重载
          </Button>
          <IconButton
            label={workPanelOpen ? "收起工作区" : "打开工作区"}
            aria-pressed={workPanelOpen}
            variant={workPanelOpen ? "primary" : "ghost"}
            onClick={toggleWorkPanel}
          >
            <SidebarSimple size={15} />
          </IconButton>
        </div>
      </header>

      {snapshot.modelFallbackMessage && (
        <div
          role="status"
          className="flex shrink-0 items-center gap-2 border-b border-line bg-warn-soft px-6 py-2 text-xs text-warn"
        >
          <WarningCircle size={13} className="shrink-0" aria-hidden="true" />
          <span className="min-w-0">{snapshot.modelFallbackMessage}</span>
        </div>
      )}

      <div className="min-h-0 flex-1">
        <MessageList messages={snapshot.messages} sessionKey={snapshot.sessionFile ?? snapshot.sessionId} />
      </div>
      <div className="px-6">
        <InlineDialogHost />
        <MessageQueue />
      </div>
      <Composer />
    </section>
  );
}
