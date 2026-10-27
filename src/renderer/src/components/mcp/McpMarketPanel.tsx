import { MagnifyingGlass } from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { McpCatalogCategory, McpCatalogEntry, McpMarketEntry } from "@shared/mcp-catalog";
import {
  Badge,
  Button,
  EmptyState,
  SkeletonCards,
  cx,
  inputClass,
} from "../ui";
import { McpCatalogInstallDialog } from "./McpCatalogInstallDialog";

const CATEGORIES: Array<{ id: "all" | McpCatalogCategory; label: string }> = [
  { id: "all", label: "全部" },
  { id: "devtools", label: "开发工具" },
  { id: "web", label: "网页" },
  { id: "docs", label: "文档" },
  { id: "data", label: "数据" },
  { id: "productivity", label: "效率" },
];

/**
 * MCP 市场：内置精选 + 官方 Registry。
 *
 * 搜索走后端（内置目录本地过滤 + Registry 服务端搜索），分类在前端过滤当前结果；
 * Registry 失败只显示错误条，内置条目照常可安装。
 */
export function McpMarketPanel({
  installedIds,
  onInstalled,
}: {
  installedIds: readonly string[];
  onInstalled: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<"all" | McpCatalogCategory>("all");
  const [entries, setEntries] = useState<McpMarketEntry[]>([]);
  const [nextCursor, setNextCursor] = useState<string | undefined>();
  const [remoteError, setRemoteError] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [installFor, setInstallFor] = useState<McpCatalogEntry | null>(null);
  const generation = useRef(0);

  useEffect(() => {
    const current = ++generation.current;
    setLoading(true);
    const timer = setTimeout(() => {
      window.pi
        .mcpMarketSearch(query)
        .then((result) => {
          if (current !== generation.current) return;
          setEntries(result.entries);
          setNextCursor(result.nextCursor);
          setRemoteError(result.remoteError);
        })
        .catch((error: unknown) => {
          if (current !== generation.current) return;
          setEntries([]);
          setNextCursor(undefined);
          setRemoteError(error instanceof Error ? error.message : String(error));
        })
        .finally(() => {
          if (current === generation.current) setLoading(false);
        });
    }, 350);
    return () => clearTimeout(timer);
  }, [query]);

  const visible = useMemo(() => {
    if (category === "all") return entries;
    return entries.filter((entry) => (entry.categories ?? []).includes(category));
  }, [entries, category]);

  const loadMore = async () => {
    if (!nextCursor || loadingMore) return;
    const current = generation.current;
    setLoadingMore(true);
    try {
      const result = await window.pi.mcpMarketSearch(query, nextCursor, true);
      if (current !== generation.current) return;
      setEntries((existing) => {
        const seen = new Set(existing.map((entry) => entry.id));
        return [...existing, ...result.entries.filter((entry) => !seen.has(entry.id))];
      });
      setNextCursor(result.nextCursor);
      if (result.remoteError) setRemoteError(result.remoteError);
    } catch (error) {
      setRemoteError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <MagnifyingGlass
            size={14}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-muted"
          />
          <input
            className={cx(inputClass, "pl-8")}
            value={query}
            placeholder="搜索服务器名称、描述或分类"
            aria-label="搜索 MCP 市场"
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <span className="text-2xs text-ink-muted">{visible.length} 个结果</span>
      </div>

      <div className="flex flex-wrap gap-1">
        {CATEGORIES.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setCategory(item.id)}
            className={cx(
              "h-7 rounded-control px-2.5 text-xs transition-colors duration-[var(--motion-instant)]",
              category === item.id
                ? "bg-accent-fill font-medium text-on-accent"
                : "bg-surface-raised text-ink-soft hover:text-ink",
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      {remoteError && (
        <div className="rounded-control border border-warn bg-warn-soft px-3 py-2 text-xs text-warn">
          在线搜索不可用：{remoteError}
        </div>
      )}

      {loading ? (
        <SkeletonCards count={4} />
      ) : visible.length === 0 ? (
        <EmptyState
          title="没有匹配的服务器"
          description="换个关键词，或清空搜索查看全部。内置目录始终可用，不依赖网络。"
          action={
            <Button size="sm" onClick={() => setQuery("")}>
              清空搜索
            </Button>
          }
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {visible.map((entry) => {
            const installed = installedIds.includes(entry.id);
            return (
              <article
                key={`${entry.source}:${entry.id}`}
                className="flex flex-col gap-2 rounded-panel border border-line bg-surface p-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <h3 className="truncate text-sm font-medium text-ink">{entry.name}</h3>
                      {entry.verified && <Badge tone="success">已验证</Badge>}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-1">
                      <Badge tone={entry.transport === "http" ? "info" : "neutral"}>
                        {entry.transport === "http" ? "HTTP" : "stdio"}
                      </Badge>
                      <Badge>{entry.source === "builtin" ? "内置" : "Registry"}</Badge>
                      {(entry.categories ?? []).map((item) => (
                        <Badge key={item}>{item}</Badge>
                      ))}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant={installed ? "secondary" : "primary"}
                    disabled={installed}
                    onClick={() => setInstallFor(entry)}
                  >
                    {installed ? "已安装" : "安装"}
                  </Button>
                </div>
                {entry.description && (
                  <p className="line-clamp-2 text-xs text-ink-muted" title={entry.description}>
                    {entry.description}
                  </p>
                )}
                {entry.notes && <p className="text-2xs text-ink-muted">{entry.notes}</p>}
              </article>
            );
          })}
        </div>
      )}

      {nextCursor && !loading && (
        <div className="flex justify-center">
          <Button size="sm" disabled={loadingMore} onClick={() => void loadMore()}>
            {loadingMore ? "加载中…" : "加载更多（官方 Registry）"}
          </Button>
        </div>
      )}

      {installFor && (
        <McpCatalogInstallDialog
          entry={installFor}
          alreadyInstalled={installedIds.includes(installFor.id)}
          onClose={() => setInstallFor(null)}
          onInstalled={(id) => {
            setInstallFor(null);
            onInstalled(id);
          }}
        />
      )}
    </div>
  );
}
