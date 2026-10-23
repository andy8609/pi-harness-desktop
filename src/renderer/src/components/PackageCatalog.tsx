import { useState } from "react";
import type { CatalogKind, CatalogPackage, ConfiguredPackageInfo, InstalledResource, PackageInventory } from "@shared/types";

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
  return (
    <div className="rounded-xl border border-[var(--line)] bg-[var(--bg-panel)] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-medium">{item.name}</div>
          <div className="mt-1 text-xs text-[var(--muted)]">
            v{item.version || "-"}
            {item.kinds.includes("skill") && item.kinds.includes("extension") ? " · 扩展 / Skill" : ""}
          </div>
          <p className="mt-2 text-sm text-[var(--text-soft)]">{item.description || "暂无描述"}</p>
          {item.keywords.filter((keyword) => keyword.toLowerCase() !== "pi-package").length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {item.keywords
                .filter((keyword) => keyword.toLowerCase() !== "pi-package")
                .slice(0, 6)
                .map((keyword) => (
                  <span key={keyword} className="rounded bg-[var(--bg-raised)] px-1.5 py-0.5 text-[10px] text-[var(--muted)]">
                    {keyword}
                  </span>
                ))}
            </div>
          )}
          <a
            href={item.npmUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-block text-xs text-[var(--accent)] hover:underline"
          >
            在 npm 查看 →
          </a>
        </div>
        {installedSource ? (
          <button
            className="shrink-0 rounded border border-[var(--line)] px-3 py-1 text-xs disabled:opacity-50"
            disabled={busy}
            onClick={() => onRemove(installedSource)}
          >
            卸载
          </button>
        ) : (
          <button
            className="shrink-0 rounded bg-[var(--accent-bg)] px-3 py-1 text-xs text-[var(--on-accent)] disabled:opacity-50"
            disabled={busy}
            onClick={() => onInstall(item.name)}
          >
            安装
          </button>
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
}: {
  title: string;
  items: InstalledResource[];
  busy: boolean;
  onToggle: (item: InstalledResource, enabled: boolean) => void;
}) {
  return (
    <div className="rounded-xl border border-[var(--line)] bg-[var(--bg-panel)] p-4">
      <h2 className="mb-3 font-medium">{title}</h2>
      {items.length === 0 ? (
        <div className="text-sm text-[var(--muted)]">暂无已解析资源</div>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <li key={`${item.kind}:${item.path}`} className="flex items-center justify-between gap-3 text-sm">
              <label className="flex min-w-0 items-center gap-2">
                <input
                  type="checkbox"
                  disabled={busy}
                  checked={item.enabled}
                  onChange={(event) => onToggle(item, event.target.checked)}
                />
                <span className="truncate">{item.name}</span>
              </label>
              <span className="shrink-0 text-xs text-[var(--muted)]">
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
    <div className="grid gap-3">
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
      {visible < items.length && (
        <button className="rounded border border-[var(--line)] px-3 py-2 text-sm" onClick={() => setVisible((count) => count + 40)}>
          显示更多（还有 {items.length - visible}）
        </button>
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
    <div className="mt-6 mb-3 flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 className="font-medium">官网目录（{count}）</h2>
        <div className="text-xs text-[var(--muted)]">
          {updatedAt ? `缓存于 ${new Date(updatedAt).toLocaleString()}` : "尚无本地缓存"}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <input
          className="w-52 rounded border border-[var(--line)] bg-[var(--bg)] px-2 py-1 text-sm"
          placeholder={placeholder}
          value={query}
          onChange={(event) => onQuery(event.target.value)}
        />
        <button
          className="rounded border border-[var(--line)] px-3 py-1 text-sm disabled:opacity-50"
          disabled={refreshing}
          onClick={onRefresh}
        >
          {refreshing ? "更新中…" : "更新目录"}
        </button>
      </div>
    </div>
  );
}

export function emptyInventory(): PackageInventory {
  return { extensions: [], skills: [], packages: [] };
}
