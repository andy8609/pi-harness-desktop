import { ArrowsClockwise, Plus } from "@phosphor-icons/react";
import { Composer } from "./Composer";
import { InlineDialogHost } from "./InlineDialogHost";
import { MessageList } from "./MessageList";
import { MessageQueue } from "./MessageQueue";
import { ModelPicker } from "./ModelPicker";
import { refreshModelsAndSessions, useAppStore } from "../stores/app-store";

export function ChatPane() {
  const snapshot = useAppStore((state) => state.snapshot);
  const applySnapshot = useAppStore((state) => state.applySnapshot);
  const pushToast = useAppStore((state) => state.pushToast);

  if (!snapshot) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-sm text-[var(--muted)]">
        从左侧打开一个项目目录。桌面端不读取 pi-main 源码，只使用官方 SDK 与 ~/.pi/agent。
      </div>
    );
  }

  return (
    <section className="flex h-full min-h-0 flex-col bg-[var(--bg)]">
      <header className="flex items-center justify-between border-b border-[var(--line)] px-4 py-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">
            {snapshot.displayName || snapshot.sessionName || "未命名会话"}
          </div>
          <div className="truncate text-xs text-[var(--muted)]">{snapshot.sessionId}</div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <ModelPicker />
          <button
            className="rounded-lg border border-[var(--line)] px-2 py-1 text-xs hover:border-[var(--accent)]"
            onClick={async () => {
              applySnapshot(await window.pi.newSession());
              await refreshModelsAndSessions();
            }}
          >
            <Plus size={12} className="mr-1 inline" />
            新会话
          </button>
          <button
            className="rounded-lg border border-[var(--line)] px-2 py-1 text-xs hover:border-[var(--accent)]"
            onClick={async () => {
              await window.pi.reload();
              await refreshModelsAndSessions();
              pushToast("info", "已重新加载资源");
            }}
          >
            <ArrowsClockwise size={12} className="mr-1 inline" />
            重载
          </button>
        </div>
      </header>
      {snapshot.modelFallbackMessage && (
        <div className="border-b border-[var(--line)] bg-[var(--bg-raised)] px-4 py-2 text-xs text-[var(--accent)]">
          {snapshot.modelFallbackMessage}
        </div>
      )}
      <div className="min-h-0 flex-1">
        <MessageList messages={snapshot.messages} />
      </div>
      <div className="px-6">
        <InlineDialogHost />
        <MessageQueue />
      </div>
      <Composer />
    </section>
  );
}
