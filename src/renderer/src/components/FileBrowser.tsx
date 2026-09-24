import { ArrowUp, File as FileIcon, Folder, FolderOpen, X } from "@phosphor-icons/react";
import { useCallback, useEffect, useState } from "react";
import type { FileContent, FileEntry } from "@shared/types";
import { useAppStore } from "../stores/app-store";

function crumbs(relDir: string): Array<{ label: string; path: string }> {
  const parts = relDir.split("/").filter(Boolean);
  const result: Array<{ label: string; path: string }> = [{ label: "根目录", path: "" }];
  let acc = "";
  for (const part of parts) {
    acc = acc ? `${acc}/${part}` : part;
    result.push({ label: part, path: acc });
  }
  return result;
}

export function FileBrowser() {
  const cwd = useAppStore((state) => state.snapshot?.cwd);
  const [relDir, setRelDir] = useState("");
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<FileContent | null>(null);
  const [error, setError] = useState<string>();

  const load = useCallback(async (dir: string) => {
    setLoading(true);
    setError(undefined);
    try {
      const list = (await window.pi.listDirectory(dir)) as FileEntry[];
      setEntries(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setSelected(null);
    void load(relDir);
  }, [relDir, load, cwd]);

  const openFile = async (entry: FileEntry) => {
    setError(undefined);
    try {
      const content = (await window.pi.readFile(entry.relative)) as FileContent;
      setSelected(content);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const trail = crumbs(relDir);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-1 border-b border-[var(--line)] px-2 py-1.5 text-xs text-[var(--muted)]">
        {relDir && (
          <button
            type="button"
            title="返回上级"
            aria-label="返回上级"
            className="rounded p-1 hover:text-[var(--text)]"
            onClick={() => setRelDir(relDir.split("/").slice(0, -1).join("/"))}
          >
            <ArrowUp size={13} />
          </button>
        )}
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1">
          {trail.map((crumb, index) => (
            <span key={crumb.path} className="flex items-center gap-1">
              {index > 0 && <span>/</span>}
              <button
                type="button"
                className="truncate hover:text-[var(--text)]"
                onClick={() => setRelDir(crumb.path)}
              >
                {crumb.label}
              </button>
            </span>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {error && <div className="px-3 py-2 text-xs text-[var(--danger)]">{error}</div>}
        {loading && <div className="px-3 py-2 text-xs text-[var(--muted)]">加载中…</div>}
        {!loading && entries.length === 0 && !error && (
          <div className="px-3 py-2 text-xs text-[var(--muted)]">空目录</div>
        )}
        {entries.map((entry) => (
          <button
            key={entry.path}
            type="button"
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-[var(--text)] hover:bg-[var(--bg-raised)]"
            onClick={() => (entry.isDir ? setRelDir(entry.relative) : void openFile(entry))}
          >
            {entry.isDir ? (
              <Folder size={13} className="shrink-0 text-[var(--accent)]" />
            ) : (
              <FileIcon size={13} className="shrink-0 text-[var(--muted)]" />
            )}
            <span className="truncate">{entry.name}</span>
          </button>
        ))}
      </div>

      {selected && (
        <div className="flex max-h-[60%] min-h-0 flex-col border-t border-[var(--line)]">
          <div className="flex items-center gap-2 border-b border-[var(--line)] px-3 py-1.5 text-xs">
            <FolderOpen size={13} className="shrink-0 text-[var(--accent)]" />
            <span className="min-w-0 flex-1 truncate text-[var(--muted)]" title={selected.relative}>
              {selected.relative}
            </span>
            <button
              type="button"
              title="关闭预览"
              aria-label="关闭预览"
              className="rounded p-0.5 text-[var(--muted)] hover:text-[var(--text)]"
              onClick={() => setSelected(null)}
            >
              <X size={13} />
            </button>
          </div>
          {selected.binary ? (
            <div className="px-3 py-2 text-xs text-[var(--muted)]">二进制文件，暂不支持预览。</div>
          ) : (
            <pre className="min-h-0 flex-1 overflow-auto px-3 py-2 text-[11px] leading-5 text-[var(--text)]">
              {selected.content}
              {selected.truncated ? "\n\n…（文件过大，已截断）" : ""}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
