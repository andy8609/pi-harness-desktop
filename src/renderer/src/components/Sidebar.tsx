import {
  ChatTeardropText,
  FolderOpen,
  GearSix,
  Lightning,
  PuzzlePiece,
  SquaresFour,
  TreeStructure,
} from "@phosphor-icons/react";
import type { AppView } from "@shared/types";
import { refreshModelsAndSessions, useAppStore } from "../stores/app-store";
import { shortPath } from "../lib/text";
import { cx } from "./ui";

interface NavItem {
  id: AppView;
  label: string;
  icon: typeof ChatTeardropText;
}

/** 导航分组：工作区承载主要工作，资源类为低频配置入口（审计项 S0-3）。 */
const NAV_GROUPS: Array<{ id: string; label: string; items: NavItem[] }> = [
  {
    id: "workspace",
    label: "工作区",
    items: [
      { id: "chat", label: "对话", icon: ChatTeardropText },
      { id: "sessions", label: "会话", icon: TreeStructure },
    ],
  },
  {
    id: "resources",
    label: "资源",
    items: [
      { id: "extensions", label: "扩展", icon: PuzzlePiece },
      { id: "skills", label: "Skills", icon: Lightning },
      { id: "models", label: "模型", icon: SquaresFour },
    ],
  },
];

function NavButton({ item, active, onSelect }: { item: NavItem; active: boolean; onSelect: () => void }) {
  const Icon = item.icon;
  return (
    <button
      type="button"
      title={item.label}
      aria-current={active ? "page" : undefined}
      onClick={onSelect}
      className={cx(
        "flex h-8 items-center gap-2 rounded-control px-2.5 text-sm transition-colors duration-[var(--motion-instant)]",
        "max-[1180px]:justify-center max-[1180px]:px-0",
        active
          ? "bg-accent-fill font-medium text-on-accent"
          : "text-ink-soft hover:bg-surface-raised hover:text-ink",
      )}
    >
      <Icon size={16} className="shrink-0" />
      <span className="truncate max-[1180px]:hidden">{item.label}</span>
    </button>
  );
}

/**
 * 侧栏：品牌 → 当前项目 → 分组导航 → 工具区。
 *
 * 相比改造前（审计 S0-1~S0-5）：
 * - 品牌区压缩为单行，标题「工作台」删除（它不对应任何界面）
 * - 项目入口升级为主操作区块，已打开时显示项目名 + 路径
 * - 导航按「工作区 / 资源」分组，设置沉到底部工具区
 * - 底部重复的会话/模型/统计元信息移除，明细归口状态栏与工作区
 */
export function Sidebar() {
  const view = useAppStore((state) => state.view);
  const setView = useAppStore((state) => state.setView);
  const snapshot = useAppStore((state) => state.snapshot);
  const applySnapshot = useAppStore((state) => state.applySnapshot);
  const pushToast = useAppStore((state) => state.pushToast);

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

  // 项目名取工作目录最后一段，而不是会话标题（会话标题不是项目标识）
  const projectName = snapshot?.cwd ? snapshot.cwd.split(/[\\/]/).filter(Boolean).pop() : undefined;
  const projectPath = snapshot?.cwd ? shortPath(snapshot.cwd) : undefined;

  return (
    <aside
      aria-label="主导航"
      className="flex w-[236px] shrink-0 flex-col border-r border-line bg-surface max-[1180px]:w-[60px]"
    >
      <div className="flex h-11 shrink-0 items-center gap-2 px-4 max-[1180px]:justify-center max-[1180px]:px-0">
        <span
          aria-hidden="true"
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-control bg-accent-fill text-2xs font-semibold text-on-accent"
        >
          Pi
        </span>
        <span className="truncate text-sm font-semibold tracking-display text-ink max-[1180px]:hidden">
          Pi Desktop
        </span>
      </div>

      <div className="shrink-0 px-2 pb-2">
        <button
          type="button"
          onClick={() => void openDirectory()}
          title={projectPath ? `切换项目目录（当前 ${snapshot?.cwd}）` : "打开项目目录"}
          className="flex w-full items-start gap-2 rounded-panel border border-line bg-surface-raised px-2.5 py-2 text-left transition-colors duration-[var(--motion-instant)] hover:border-accent max-[1180px]:justify-center max-[1180px]:px-0"
        >
          <FolderOpen size={16} className="mt-0.5 shrink-0 text-ink-muted" />
          <span className="min-w-0 flex-1 max-[1180px]:hidden">
            <span className="block truncate text-xs font-medium text-ink">
              {projectName ?? "打开项目目录"}
            </span>
            <span className="mt-0.5 block truncate text-2xs text-ink-muted">
              {projectPath ?? "选择工作目录后开始对话"}
            </span>
          </span>
        </button>
      </div>

      <nav className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-2 pb-2">
        {NAV_GROUPS.map((group) => (
          <div key={group.id} className="flex flex-col gap-0.5">
            <div className="px-2.5 pb-1 text-2xs font-medium tracking-[0.12em] text-ink-muted max-[1180px]:hidden">
              {group.label}
            </div>
            {group.items.map((item) => (
              <NavButton
                key={item.id}
                item={item}
                active={view === item.id}
                onSelect={() => setView(item.id)}
              />
            ))}
          </div>
        ))}
      </nav>

      <div className="flex shrink-0 flex-col gap-0.5 border-t border-line px-2 py-2">
        <NavButton
          item={{ id: "settings", label: "设置", icon: GearSix }}
          active={view === "settings"}
          onSelect={() => setView("settings")}
        />
      </div>
    </aside>
  );
}
