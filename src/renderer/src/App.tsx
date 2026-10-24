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
    <div className="flex h-full min-h-0 flex-col bg-canvas text-ink">
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main aria-label="主内容" data-view={view} className="relative min-h-0 min-w-[320px] flex-1">
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
        </main>
        <WorkPanel />
      </div>
      <StatusBar />
      <DialogHost />
      <Toasts />
    </div>
  );
}
