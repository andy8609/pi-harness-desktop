import { ChatTeardropText, FolderOpen, GearSix, Lightning, PuzzlePiece, SquaresFour, TreeStructure } from "@phosphor-icons/react";
import { refreshModelsAndSessions, useAppStore } from "../stores/app-store";
import { shortPath } from "../lib/text";
import type { AppView } from "@shared/types";

const NAV: Array<{ id: AppView; label: string; icon: typeof ChatTeardropText }> = [
  { id: "chat", label: "对话", icon: ChatTeardropText },
  { id: "sessions", label: "会话", icon: TreeStructure },
  { id: "extensions", label: "扩展", icon: PuzzlePiece },
  { id: "skills", label: "Skills", icon: Lightning },
  { id: "models", label: "模型", icon: SquaresFour },
  { id: "settings", label: "设置", icon: GearSix },
];

export function Sidebar() {
  const view = useAppStore((state) => state.view);
  const setView = useAppStore((state) => state.setView);
  const snapshot = useAppStore((state) => state.snapshot);
  const applySnapshot = useAppStore((state) => state.applySnapshot);
  const pushToast = useAppStore((state) => state.pushToast);

  return (
    <aside className="flex w-[232px] shrink-0 flex-col border-r border-[#33392a] bg-[#1a1d16]">
      <div className="px-4 pb-3 pt-5">
        <div className="text-[11px] tracking-[0.18em] text-[#9a937c]">PI DESKTOP</div>
        <div className="mt-1 text-lg font-semibold text-[#ece7d5]">工作台</div>
      </div>
      <button
        className="mx-3 mb-3 flex items-center gap-2 rounded-lg border border-[#33392a] bg-[#22261c] px-3 py-2 text-left text-sm text-[#ece7d5] hover:border-[#c4d45a]"
        onClick={async () => {
          try {
            const snapshot = await window.pi.openDirectory();
            if (snapshot) {
              applySnapshot(snapshot);
              await refreshModelsAndSessions();
              setView("chat");
            }
          } catch (error) {
            pushToast("error", error instanceof Error ? error.message : String(error));
          }
        }}
      >
        <FolderOpen size={16} />
        <span className="min-w-0 truncate">{snapshot?.cwd ? shortPath(snapshot.cwd) : "打开项目目录"}</span>
      </button>
      <nav className="flex flex-col gap-1 px-2">
        {NAV.map((item) => {
          const Icon = item.icon;
          const active = view === item.id;
          return (
            <button
              key={item.id}
              className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${
                active ? "bg-[#c4d45a] text-[#16180f]" : "text-[#ece7d5] hover:bg-[#22261c]"
              }`}
              onClick={() => setView(item.id)}
            >
              <Icon size={16} />
              {item.label}
            </button>
          );
        })}
      </nav>
      <div className="mt-auto border-t border-[#33392a] px-4 py-3 text-xs text-[#9a937c]">
        <div>会话 {snapshot?.displayName || snapshot?.sessionName || snapshot?.sessionId.slice(0, 8) || "-"}</div>
        <div className="mt-1 truncate">{snapshot?.model ? `${snapshot.model.provider}/${snapshot.model.id}` : "未选择模型"}</div>
        <div className="mt-1">
          扩展 {snapshot?.resources.extensions.length ?? 0} · Skills {snapshot?.resources.skills.length ?? 0}
        </div>
      </div>
    </aside>
  );
}
