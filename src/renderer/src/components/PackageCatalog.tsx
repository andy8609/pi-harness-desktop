import { useState } from "react";
import type { CatalogKind, CatalogPackage, ConfiguredPackageInfo, InstalledResource, PackageInventory } from "@shared/types";
import { Badge, Button, EmptyState, SegmentedControl, SkeletonCards, SkeletonList, Switch, cx, inputClass } from "./ui";

export function packageNameFromSource(source: string): string {
  const spec = source.startsWith("npm:") ? source.slice(4) : source;
  if (spec.startsWith("@")) {
    const [scope, rest = ""] = spec.split("/");
    return `${scope}/${rest.split("@")[0]}`;
  }
  return spec.split("@")[0] ?? spec;
}

export function findConfiguredSource(name: string, packages: ConfiguredPackageInfo[]): string | undefined {
  return packages.find((item) => packageNameFromSource(item.source) === name)?.source;
}

export function CatalogCard({
  item,
  busy,
  installedSource,
  onInstall,
  onRemove,
}: {
  item: CatalogPackage;
  busy: boolean;
  installedSource?: string;
  onInstall: (name: string) => void;
  onRemove: (source: string) => void;
}) {
  const kindLabel = item.kinds.includes("skill") && item.kinds.includes("extension") ? "扩展 / Skill" : undefined;
  return (
    <div className="flex flex-col rounded-panel border border-line bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate font-medium text-ink">{item.name}</span>
            <Badge>v{item.version || "-"}</Badge>
            {kindLabel && <Badge tone="accent">{kindLabel}</Badge>}
          </div>
          <p className="mt-2 text-sm text-ink-soft">{item.description || "暂无描述"}</p>
          {item.keywords.filter((keyword) => keyword.toLowerCase() !== "pi-package").length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {item.keywords
                .filter((keyword) => keyword.toLowerCase() !== "pi-package")
                .slice(0, 6)
                .map((keyword) => (
                  <span key={keyword} className="rounded-control bg-surface-raised px-1.5 py-0.5 text-2xs text-ink-muted">
                    {keyword}
                  </span>
                ))}
            </div>
          )}
          <a href={item.npmUrl} target="_blank" rel="noreferrer" className="mt-2 inline-block text-xs text-accent hover:underline">
            在 npm 查看
          </a>
        </div>
        {installedSource ? (
          <Button variant="danger" size="sm" disabled={busy} onClick={() => onRemove(installedSource)}>
            卸载
          </Button>
        ) : (
          <Button variant="primary" size="sm" disabled={busy} onClick={() => onInstall(item.name)}>
            安装
          </Button>
        )}
      </div>
    </div>
  );
}

export function InstalledToggleList({
  title,
  items,
  busy,
  onToggle,
  onBrowse,
}: {
  title: string;
  items: InstalledResource[];
  busy: boolean;
  onToggle: (item: InstalledResource, enabled: boolean) => void;
  /** 空态时跳转到目录视图的入口（规范 R6：空态必须给出下一步）。 */
  onBrowse?: () => void;
}) {
  return (
    <div className="rounded-panel border border-line bg-surface">
      <div className="flex items-center justify-between gap-2 border-b border-line-subtle px-4 py-3">
        <h2 className="text-sm font-medium text-ink">{title}</h2>
        <Badge>{items.length}</Badge>
      </div>
      {items.length === 0 ? (
        <div className="p-4">
          <EmptyState
            compact
            title="还没有已解析的资源"
            description={`安装后重启会话，或到「目录」页点「更新目录」重新解析。`}
            action={
              onBrowse ? (
                <Button size="sm" onClick={onBrowse}>
                  浏览目录
                </Button>
              ) : undefined
            }
          />
        </div>
      ) : (
        <ul className="divide-y divide-line-subtle">
          {items.map((item) => (
            <li key={`${item.kind}:${item.path}`} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
              <div className="flex min-w-0 items-center gap-2.5">
                <Switch
                  checked={item.enabled}
                  disabled={busy}
                  label={`${item.enabled ? "停用" : "启用"} ${item.name}`}
                  onChange={(next) => onToggle(item, next)}
                />
                <span className="truncate text-ink" title={item.path}>
                  {item.name}
                </span>
              </div>
              <span className="shrink-0 text-2xs text-ink-muted">
                {item.origin === "package" ? item.source : item.scope === "user" ? "用户" : "项目"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function filterCatalog(catalog: CatalogPackage[], kind: CatalogKind, query: string): CatalogPackage[] {
  const needle = query.trim().toLowerCase();
  return catalog.filter((item) => {
    if (!item.kinds.includes(kind)) return false;
    if (!needle) return true;
    return (
      item.name.toLowerCase().includes(needle) ||
      item.description.toLowerCase().includes(needle) ||
      item.keywords.some((keyword) => keyword.toLowerCase().includes(needle))
    );
  });
}

export function CatalogGrid({
  items,
  busy,
  packages,
  onInstall,
  onRemove,
}: {
  items: CatalogPackage[];
  busy: boolean;
  packages: ConfiguredPackageInfo[];
  onInstall: (name: string) => void;
  onRemove: (source: string) => void;
}) {
  const [visible, setVisible] = useState(40);
  const shown = items.slice(0, visible);
  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 xl:grid-cols-2">
        {shown.map((item) => (
          <CatalogCard
            key={item.name}
            item={item}
            busy={busy}
            installedSource={findConfiguredSource(item.name, packages)}
            onInstall={onInstall}
            onRemove={onRemove}
          />
        ))}
      </div>
      {visible < items.length && (
        <div>
          <Button onClick={() => setVisible((count) => count + 40)}>显示更多（还有 {items.length - visible}）</Button>
        </div>
      )}
    </div>
  );
}

export function CatalogToolbar({
  count,
  query,
  placeholder,
  updatedAt,
  refreshing,
  onQuery,
  onRefresh,
}: {
  count: number;
  query: string;
  placeholder: string;
  updatedAt?: number;
  refreshing: boolean;
  onQuery: (value: string) => void;
  onRefresh: () => void;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-sm font-medium text-ink">npm 目录（{count}）</h2>
        <div className="mt-0.5 text-2xs text-ink-muted">
          {updatedAt ? `缓存于 ${new Date(updatedAt).toLocaleString()}` : "尚无本地缓存"}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <input
          type="search"
          aria-label={placeholder}
          className={cx(inputClass, "w-52")}
          placeholder={placeholder}
          value={query}
          onChange={(event) => onQuery(event.target.value)}
        />
        <Button disabled={refreshing} onClick={onRefresh}>
          {refreshing ? "更新中…" : "更新目录"}
        </Button>
      </div>
    </div>
  );
}

export type CatalogTab = "installed" | "catalog";

/** 顶部「已安装 / 目录」视图切换：两种心智模型分开，避免互相顶走（审计 S3-2）。 */
export function CatalogTabs({
  tab,
  installedCount,
  catalogCount,
  onChange,
}: {
  tab: CatalogTab;
  installedCount: number;
  catalogCount: number;
  onChange: (next: CatalogTab) => void;
}) {
  return (
    <SegmentedControl
      ariaLabel="资源视图"
      value={tab}
      onChange={onChange}
      options={[
        { id: "installed", label: `已安装 ${installedCount}` },
        { id: "catalog", label: `目录 ${catalogCount}` },
      ]}
    />
  );
}

export function emptyInventory(): PackageInventory {
  return { extensions: [], skills: [], packages: [] };
}

/** 目录与已安装列表共用的加载骨架。 */
export function CatalogSkeleton({ tab }: { tab: CatalogTab }) {
  return tab === "installed" ? <SkeletonList rows={3} /> : <SkeletonCards count={4} />;
}
