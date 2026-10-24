import { useEffect } from "react";
import { ChatPane } from "./components/ChatPane";
import { DialogHost } from "./components/DialogHost";
import { ExtensionsPage } from "./components/ExtensionsPage";
import { ModelsPage } from "./components/ModelsPage";
import { SessionsPage } from "./components/SessionsPage";
import { SettingsPage } from "./components/SettingsPage";
import { Sidebar } from "./components/Sidebar";
import { SkillsPage } from "./components/SkillsPage";
import { StatusBar } from "./components/StatusBar";
import { Toasts } from "./components/Toasts";
import { WorkPanel } from "./components/WorkPanel";
import { bootstrapApp, useAppStore } from "./stores/app-store";
import { ErrorBoundary } from "./components/ui";

export function App() {
  const view = useAppStore((state) => state.view);
  const setDialog = useAppStore((state) => state.setDialog);

  useEffect(() => {
    void bootstrapApp();
    let text = "";
    let thinking = "";
    let timer = 0;
    const flush = () => {
      timer = 0;
      const handle = useAppStore.getState().handleEvent;
      if (thinking) {
        const delta = thinking;
        thinking = "";
        handle({ type: "thinking_delta", delta });
      }
      if (text) {
        const delta = text;
        text = "";
        handle({ type: "text_delta", delta });
      }
    };
    const offEvent = window.pi.onEvent((event) => {
      if (event.type === "text_delta" && event.delta) {
        text += event.delta;
        if (!timer) timer = window.setTimeout(flush, 32);
        return;
      }
      if (event.type === "thinking_delta" && event.delta) {
        thinking += event.delta;
        if (!timer) timer = window.setTimeout(flush, 32);
        return;
      }
      if (timer) {
        window.clearTimeout(timer);
        flush();
      }
      useAppStore.getState().handleEvent(event);
    });
    const offDialog = window.pi.onDialog(setDialog);
    return () => {
      if (timer) window.clearTimeout(timer);
      offEvent();
      offDialog();
    };
  }, [setDialog]);

  return (
    <ErrorBoundary
      label="app"
      fallback={(error, reset) => (
        <div className="flex h-full flex-col items-center justify-center gap-3 bg-canvas p-6 text-center">
          <div className="text-base font-medium text-ink">界面初始化失败</div>
          <div className="max-w-lg break-words text-sm text-ink-muted">{error.message}</div>
          <button
            type="button"
            className="h-8 rounded-control bg-accent-fill px-3 text-sm font-medium text-on-accent"
            onClick={reset}
          >
            重试
          </button>
          <div className="text-2xs text-ink-muted">若反复失败，请重启应用；详细堆栈见开发者工具控制台。</div>
        </div>
      )}
    >
      <div className="flex h-full min-h-0 flex-col bg-canvas text-ink">
        <div className="flex min-h-0 flex-1">
          <Sidebar />
          <main aria-label="主内容" data-view={view} className="relative min-h-0 min-w-[320px] flex-1">
            <ErrorBoundary label={`view:${view}`}>
              <div className={view === "chat" ? "h-full" : "hidden h-full"}>
                <ChatPane />
              </div>
              {view === "sessions" && <SessionsPage />}
              {view === "extensions" && <ExtensionsPage />}
              {view === "skills" && <SkillsPage />}
              <div className={view === "models" ? "h-full" : "hidden h-full"}>
                <ModelsPage />
              </div>
              {view === "settings" && <SettingsPage />}
            </ErrorBoundary>
          </main>
          <ErrorBoundary label="work-panel">
            <WorkPanel />
          </ErrorBoundary>
        </div>
        <StatusBar />
        <DialogHost />
        <Toasts />
      </div>
    </ErrorBoundary>
  );
}
