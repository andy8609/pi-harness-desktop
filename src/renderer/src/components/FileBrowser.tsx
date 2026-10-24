import { CaretDown, CaretRight, File as FileIcon, Folder, FolderOpen, X } from "@phosphor-icons/react";
import { useCallback, useEffect, useState, type MouseEvent } from "react";
import type { FileContent, FileEntry } from "@shared/types";
import { useAppStore } from "../stores/app-store";
import { Button, EmptyState, SkeletonList } from "./ui";

/**
 * 树形单行：目录点击展开/折叠（首次展开懒加载子项），文件点击打开预览，
 * 任意节点右键弹出"添加为引用"菜单。
 */
function TreeRow({
  entry,
  depth,
  onOpenFile,
  onContextMenu,
}: {
  entry: FileEntry;
  depth: number;
  onOpenFile: (entry: FileEntry) => void;
  onContextMenu: (event: MouseEvent, entry: FileEntry) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<FileEntry[] | null>(null);
  const [loading, setLoading] = useState(false);

  // 首次展开时懒加载该目录的直接子项；加载失败保持未加载状态，可再次点击重试。
  const toggle = async () => {
    if (!entry.isDir) return;
    if (!expanded && children === null) {
      setLoading(true);
      try {
        setChildren((await window.pi.listDirectory(entry.relative)) as FileEntry[]);
      } catch {
        // 忽略单目录加载失败：保持折叠，用户可重试
      } finally {
        setLoading(false);
      }
    }
    setExpanded((value) => !value);
  };

  return (
    <div>
      <button
        type="button"
        className="flex w-full items-center gap-1 py-1 pr-2 text-left text-xs text-ink hover:bg-surface-raised"
        style={{ paddingLeft: 8 + depth * 14 }}
        title={entry.relative}
        onClick={() => (entry.isDir ? void toggle() : onOpenFile(entry))}
        onContextMenu={(event) => onContextMenu(event, entry)}
      >
        {entry.isDir ? (
          expanded ? (
            <CaretDown size={11} className="shrink-0 text-ink-muted" />
          ) : (
            <CaretRight size={11} className="shrink-0 text-ink-muted" />
          )
        ) : (
          <span className="w-[11px] shrink-0" />
        )}
        {entry.isDir ? (
          expanded ? (
            <FolderOpen size={13} className="shrink-0 text-accent" />
          ) : (
            <Folder size={13} className="shrink-0 text-accent" />
          )
        ) : (
          <FileIcon size={13} className="shrink-0 text-ink-muted" />
        )}
        <span className="truncate">{entry.name}</span>
      </button>
      {entry.isDir && expanded && (
        <div>
          {loading ? (
            <div className="py-1 text-2xs text-ink-muted" style={{ paddingLeft: 22 + depth * 14 }}>
              加载中…
            </div>
          ) : (
            (children ?? []).map((child) => (
              <TreeRow
                key={child.path}
                entry={child}
                depth={depth + 1}
                onOpenFile={onOpenFile}
                onContextMenu={onContextMenu}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

export function FileBrowser() {
  const cwd = useAppStore((state) => state.snapshot?.cwd);
  const pushReference = useAppStore((state) => state.pushReference);
  const pushToast = useAppStore((state) => state.pushToast);
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<FileContent | null>(null);
  const [error, setError] = useState<string>();
  const [menu, setMenu] = useState<{ x: number; y: number; entry: FileEntry } | null>(null);

  // 加载项目根目录列表（listDirectory 已按"目录在前、字母序"排序并跳过 node_modules 等）
  const load = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      setEntries((await window.pi.listDirectory("")) as FileEntry[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setSelected(null);
    setMenu(null);
    void load();
  }, [load, cwd]);

  const openFile = async (entry: FileEntry) => {
    setError(undefined);
    try {
      const content = (await window.pi.readFile(entry.relative)) as FileContent;
      setSelected(content);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  // 右键菜单打开期间：点击任意位置、按 Escape 或窗口失焦即关闭
  useEffect(() => {
    if (!menu) return;
    const close = (event: Event) => {
      if (event instanceof KeyboardEvent && event.key !== "Escape") return;
      setMenu(null);
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", close);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", close);
      window.removeEventListener("blur", close);
    };
  }, [menu]);

  const openMenu = (event: MouseEvent, entry: FileEntry) => {
    event.preventDefault();
    event.stopPropagation();
    setMenu({ x: event.clientX, y: event.clientY, entry });
  };

  // 将右键选中的文件/文件夹作为 @引用 加入输入框（由 Composer 消费）
  const addReference = () => {
    if (!menu) return;
    pushReference(menu.entry.relative);
    pushToast("info", `已添加引用 @${menu.entry.relative}`);
    setMenu(null);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-auto">
        {loading && (
          <div className="p-2">
            <SkeletonList rows={4} />
          </div>
        )}
        {!loading && error && (
          <div className="p-2">
            <EmptyState
              compact
              title="目录加载失败"
              description={error}
              action={
                <Button size="sm" onClick={() => void load()}>
                  重试
                </Button>
              }
            />
          </div>
        )}
        {!loading && !error && entries.length === 0 && (
          <div className="p-2">
            <EmptyState compact title="目录为空" description="这个目录下没有可显示的文件。" />
          </div>
        )}
        {!loading && entries.map((entry) => (
          <TreeRow key={entry.path} entry={entry} depth={0} onOpenFile={openFile} onContextMenu={openMenu} />
        ))}
      </div>

      {menu && (
        <div
          className="fixed z-[var(--z-popover)] min-w-[140px] rounded-control border border-line bg-surface py-1 shadow-floating"
          style={{
            left: Math.min(menu.x, window.innerWidth - 150),
            top: Math.min(menu.y, window.innerHeight - 40),
          }}
          // 阻止 mousedown 冒泡，避免点击菜单项时菜单先被全局监听关闭
          onMouseDown={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          <button
            type="button"
            className="block w-full px-3 py-1.5 text-left text-xs text-ink hover:bg-surface-raised"
            onClick={addReference}
          >
            添加为引用
          </button>
        </div>
      )}

      {selected && (
        <div className="flex max-h-[60%] min-h-0 flex-col border-t border-line">
          <div className="flex items-center gap-2 border-b border-line px-3 py-1.5 text-xs">
            <FolderOpen size={13} className="shrink-0 text-accent" />
            <span className="min-w-0 flex-1 truncate text-ink-muted" title={selected.relative}>
              {selected.relative}
            </span>
            <button
              type="button"
              title="关闭预览"
              aria-label="关闭预览"
              className="rounded p-0.5 text-ink-muted hover:text-ink"
              onClick={() => setSelected(null)}
            >
              <X size={13} />
            </button>
          </div>
          {selected.binary ? (
            <div className="px-3 py-2 text-xs text-ink-muted">二进制文件，暂不支持预览。</div>
          ) : (
            <pre className="min-h-0 flex-1 overflow-auto px-3 py-2 text-xs leading-5 text-ink">
              {selected.content}
              {selected.truncated ? "\n\n…（文件过大，已截断）" : ""}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
