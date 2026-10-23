import { FileArrowUp } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import { refreshModelsAndSessions, useAppStore } from "../stores/app-store";

/** 技能图标底色板（柔和底色 + 同色深字，两种主题都可读） */
const BADGE_COLORS = [
  "bg-[var(--accent-soft)] text-[var(--accent)]",
  "bg-[var(--info-soft)] text-[var(--info)]",
  "bg-[var(--danger-soft)] text-[var(--danger)]",
  "bg-[var(--purple-soft)] text-[var(--purple)]",
  "bg-[var(--ok-soft)] text-[var(--ok)]",
  "bg-[var(--warn-soft)] text-[var(--warn)]",
];

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
 * 技能列表面板：搜索已安装技能并插入 /skill:<名称> 命令，
 * 底部支持导入本地 SKILL.md 文件或技能目录。由加号菜单展开。
 */
export function SkillPicker({ onSelect }: { onSelect: (name: string) => void }) {
  const skills = useAppStore((state) => state.snapshot?.resources.skills);
  const pushToast = useAppStore((state) => state.pushToast);
  const [query, setQuery] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const list = skills ?? [];

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return list;
    return list.filter((skill) =>
      `${skill.name} ${skill.description ?? ""}`.toLowerCase().includes(needle),
    );
  }, [list, query]);

  const importSkill = async (kind: "file" | "dir") => {
    setBusy(true);
    try {
      const result = kind === "file" ? await window.pi.importSkillFile() : await window.pi.importSkillDir();
      if (!result) return;
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
    <div className="w-80 rounded-lg border border-[var(--line)] bg-[var(--bg-panel)] shadow-xl">
      <div className="border-b border-[var(--line)] p-2">
        <input
          autoFocus
          className="w-full rounded border border-[var(--line)] bg-[var(--bg)] px-2 py-1 text-xs text-[var(--text)] outline-none placeholder:text-[var(--muted)] focus:border-[var(--accent)]"
          placeholder="搜索技能"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <div className="max-h-64 overflow-y-auto py-1">
        {filtered.length === 0 ? (
          <div className="px-3 py-2 text-xs text-[var(--muted)]">
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
                className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-[var(--bg-raised)]"
                onClick={() => onSelect(skill.name)}
              >
                <span
                  className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-medium ${badge.color}`}
                >
                  {badge.letter}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs text-[var(--text)]">{skill.name}</span>
                  {skill.description && (
                    <span className="block truncate text-[11px] text-[var(--muted)]">{skill.description}</span>
                  )}
                </span>
              </button>
            );
          })
        )}
      </div>
      <div className="border-t border-[var(--line)]">
        <button
          type="button"
          disabled={busy}
          className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-[var(--text)] hover:bg-[var(--bg-raised)] disabled:opacity-50"
          onClick={() => setImportOpen((value) => !value)}
        >
          <FileArrowUp size={14} className="shrink-0 text-[var(--muted)]" />
          导入技能
          {busy && <span className="text-[11px] text-[var(--muted)]">处理中…</span>}
        </button>
        {importOpen && (
          <div className="pb-1">
            <button
              type="button"
              disabled={busy}
              className="block w-full py-1.5 pr-3 pl-9 text-left text-xs text-[var(--muted)] hover:bg-[var(--bg-raised)] hover:text-[var(--text)] disabled:opacity-50"
              onClick={() => void importSkill("file")}
            >
              从 SKILL.md 文件导入
            </button>
            <button
              type="button"
              disabled={busy}
              className="block w-full py-1.5 pr-3 pl-9 text-left text-xs text-[var(--muted)] hover:bg-[var(--bg-raised)] hover:text-[var(--text)] disabled:opacity-50"
              onClick={() => void importSkill("dir")}
            >
              从技能目录导入
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
