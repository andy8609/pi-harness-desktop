import { FileArrowUp, Sparkle } from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { refreshModelsAndSessions, useAppStore } from "../stores/app-store";

/** 技能图标底色板（深色主题下保持可读的柔和色） */
const BADGE_COLORS = ["bg-[#c4d45a]", "bg-[#7eb8c9]", "bg-[#e07a5f]", "bg-[#b48ec9]", "bg-[#8fbf5a]", "bg-[#d9a05b]"];

/** 按技能名生成稳定的图标底色与首字符 */
function skillBadge(name: string): { letter: string; color: string } {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) % 997;
  return {
    letter: ([...name][0] ?? "?").toUpperCase(),
    color: BADGE_COLORS[hash % BADGE_COLORS.length],
  };
}

/**
 * 发送区的技能选择器：搜索已安装技能并插入 /skill:<名称> 命令，
 * 底部支持导入本地 SKILL.md 文件或技能目录。
 */
export function SkillPicker({ onSelect }: { onSelect: (name: string) => void }) {
  const skills = useAppStore((state) => state.snapshot?.resources.skills);
  const pushToast = useAppStore((state) => state.pushToast);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const list = skills ?? [];

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return list;
    return list.filter((skill) =>
      `${skill.name} ${skill.description ?? ""}`.toLowerCase().includes(needle),
    );
  }, [list, query]);

  // 面板打开期间：点击外部或按 Escape 关闭
  useEffect(() => {
    if (!open) return;
    const close = (event: Event) => {
      if (event instanceof KeyboardEvent) {
        if (event.key === "Escape") setOpen(false);
        return;
      }
      const target = event.target as Node | null;
      if (target && rootRef.current && !rootRef.current.contains(target)) setOpen(false);
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", close);
    };
  }, [open]);

  const toggle = () => {
    setOpen((value) => {
      const next = !value;
      if (next) {
        setQuery("");
        setImportOpen(false);
      }
      return next;
    });
  };

  const pick = (name: string) => {
    onSelect(name);
    setOpen(false);
  };

  const importSkill = async (kind: "file" | "dir") => {
    setBusy(true);
    try {
      const result = kind === "file" ? await window.pi.importSkillFile() : await window.pi.importSkillDir();
      if (!result) return; // 用户在文件对话框中取消
      await refreshModelsAndSessions();
      pushToast("info", kind === "file" ? "已导入本地 Skill 文件" : "已导入本地 Skill 目录");
      setImportOpen(false);
    } catch (error) {
      pushToast("error", error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-expanded={open}
        className={`flex items-center gap-1 rounded px-1.5 py-0.5 ${
          open ? "text-[#c4d45a]" : "hover:text-[#ece7d5]"
        }`}
        onClick={toggle}
      >
        <Sparkle size={14} />
        Skills
      </button>
      {open && (
        <div className="absolute bottom-full left-0 z-40 mb-2 w-80 rounded-lg border border-[#33392a] bg-[#1a1d16] shadow-xl">
          <div className="border-b border-[#33392a] p-2">
            <input
              autoFocus
              className="w-full rounded border border-[#33392a] bg-[#12140f] px-2 py-1 text-xs text-[#ece7d5] outline-none placeholder:text-[#9a937c] focus:border-[#c4d45a]"
              placeholder="搜索技能"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <div className="max-h-64 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <div className="px-3 py-2 text-xs text-[#9a937c]">
                {list.length === 0 ? "尚未安装技能" : "无匹配技能"}
              </div>
            ) : (
              filtered.map((skill) => {
                const badge = skillBadge(skill.name);
                return (
                  <button
                    key={skill.name}
                    type="button"
                    title={`插入 /skill:${skill.name}`}
                    className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-[#22261c]"
                    onClick={() => pick(skill.name)}
                  >
                    <span
                      className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-medium text-[#16180f] ${badge.color}`}
                    >
                      {badge.letter}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs text-[#ece7d5]">{skill.name}</span>
                      {skill.description && (
                        <span className="block truncate text-[11px] text-[#9a937c]">{skill.description}</span>
                      )}
                    </span>
                  </button>
                );
              })
            )}
          </div>
          <div className="border-t border-[#33392a]">
            <button
              type="button"
              disabled={busy}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-[#ece7d5] hover:bg-[#22261c] disabled:opacity-50"
              onClick={() => setImportOpen((value) => !value)}
            >
              <FileArrowUp size={14} className="shrink-0 text-[#9a937c]" />
              导入技能
              {busy && <span className="text-[11px] text-[#9a937c]">处理中…</span>}
            </button>
            {importOpen && (
              <div className="pb-1">
                <button
                  type="button"
                  disabled={busy}
                  className="block w-full py-1.5 pr-3 pl-9 text-left text-xs text-[#9a937c] hover:bg-[#22261c] hover:text-[#ece7d5] disabled:opacity-50"
                  onClick={() => void importSkill("file")}
                >
                  从 SKILL.md 文件导入
                </button>
                <button
                  type="button"
                  disabled={busy}
                  className="block w-full py-1.5 pr-3 pl-9 text-left text-xs text-[#9a937c] hover:bg-[#22261c] hover:text-[#ece7d5] disabled:opacity-50"
                  onClick={() => void importSkill("dir")}
                >
                  从技能目录导入
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
