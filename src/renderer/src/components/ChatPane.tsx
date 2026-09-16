import { ArrowsClockwise, Copy, Plus } from "@phosphor-icons/react";
import { Composer } from "./Composer";
import { MessageList } from "./MessageList";
import { ModelPicker } from "./ModelPicker";
import { contentText } from "../lib/text";
import { refreshModelsAndSessions, useAppStore } from "../stores/app-store";

export function ChatPane() {
  const snapshot = useAppStore((state) => state.snapshot);
  const applySnapshot = useAppStore((state) => state.applySnapshot);
  const pushToast = useAppStore((state) => state.pushToast);

  if (!snapshot) {
    return (
      <div className="flex h-full items-center justify-center text-[#9a937c]">
        从左侧打开一个项目目录。桌面端不读取 pi-main 源码，只使用官方 SDK 与 ~/.pi/agent。
      </div>
    );
  }

  return (
    <section className="flex h-full min-h-0 flex-col bg-[#12140f]">
      <header className="flex items-center justify-between border-b border-[#33392a] px-4 py-3">
        <div>
          <div className="text-sm font-medium">{snapshot.displayName || snapshot.sessionName || "未命名会话"}</div>
          <div className="text-xs text-[#9a937c]">{snapshot.sessionId}</div>
        </div>
        <div className="flex items-center gap-2">
          <ModelPicker />
          <button
            className="rounded-lg border border-[#33392a] px-2 py-1 text-xs hover:border-[#c4d45a]"
            onClick={async () => {
              applySnapshot(await window.pi.newSession());
              await refreshModelsAndSessions();
            }}
          >
            <Plus size={12} className="mr-1 inline" />
            新会话
          </button>
          <button
            className="rounded-lg border border-[#33392a] px-2 py-1 text-xs hover:border-[#c4d45a]"
            onClick={async () => {
              await window.pi.reload();
              await refreshModelsAndSessions();
              pushToast("info", "已重新加载资源");
            }}
          >
            <ArrowsClockwise size={12} className="mr-1 inline" />
            重载
          </button>
          <button
            className="rounded-lg border border-[#33392a] px-2 py-1 text-xs hover:border-[#c4d45a]"
            onClick={async () => {
              const last = [...snapshot.messages].reverse().find((message) => message.role === "assistant");
              const text = last ? contentText(last.content) : "";
              if (text) {
                await navigator.clipboard.writeText(text);
                pushToast("info", "已复制最后一条回复");
              }
            }}
          >
            <Copy size={12} className="mr-1 inline" />
            复制
          </button>
        </div>
      </header>
      {snapshot.modelFallbackMessage && (
        <div className="border-b border-[#33392a] bg-[#22261c] px-4 py-2 text-xs text-[#c4d45a]">{snapshot.modelFallbackMessage}</div>
      )}
      <div className="min-h-0 flex-1 overflow-auto px-6 py-4">
        <MessageList messages={snapshot.messages} />
      </div>
      <Composer />
    </section>
  );
}
