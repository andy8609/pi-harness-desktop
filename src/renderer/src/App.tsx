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
import { bootstrapApp, useAppStore } from "./stores/app-store";

export function App() {
  const view = useAppStore((state) => state.view);
  const handleEvent = useAppStore((state) => state.handleEvent);
  const setDialog = useAppStore((state) => state.setDialog);

  useEffect(() => {
    void bootstrapApp();
    const offEvent = window.pi.onEvent(handleEvent);
    const offDialog = window.pi.onDialog(setDialog);
    return () => {
      offEvent();
      offDialog();
    };
  }, [handleEvent, setDialog]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="min-w-0 flex-1">
          {view === "chat" && <ChatPane />}
          {view === "sessions" && <SessionsPage />}
          {view === "extensions" && <ExtensionsPage />}
          {view === "skills" && <SkillsPage />}
          {view === "models" && <ModelsPage />}
          {view === "settings" && <SettingsPage />}
        </main>
      </div>
      <StatusBar />
      <DialogHost />
      <Toasts />
    </div>
  );
}
