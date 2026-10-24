import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { CatalogKind, CatalogPackage, InstalledResource, PackageInventory } from "@shared/types";
import { refreshModelsAndSessions, useAppStore } from "../stores/app-store";
import {
  CatalogGrid,
  CatalogTabs,
  CatalogToolbar,
  InstalledToggleList,
  emptyInventory,
  filterCatalog,
  type CatalogTab,
} from "./PackageCatalog";
import { Button, EmptyState, PageHeader, PageShell, SkeletonCards, SkeletonList } from "./ui";

/**
 * 扩展页与 Skills 页的共用实现。
 *
 * 改造前两个页面约 95% 代码逐行重复（审计 S3-1），且「已安装」与「目录」两种心智模型
 * 混在同一个滚动流里（S3-2）。现在：单实现 + 顶部视图切换 + 加载/空态骨架。
 */
export function PackagePage({
  kind,
  title,
  description,
  searchPlaceholder,
  actions,
  quickActions,
}: {
  kind: CatalogKind;
  title: string;
  description: ReactNode;
  searchPlaceholder: string;
  actions?: ReactNode;
  /** 页头快捷操作：需要重建资源清单（如导入）的动作走这里，保证导入后列表实时更新。 */
  quickActions?: Array<{ label: string; action: () => Promise<PackageInventory | null>; success: string }>;
}) {
  const pushToast = useAppStore((state) => state.pushToast);
  const [catalog, setCatalog] = useState<CatalogPackage[]>([]);
  const [updatedAt, setUpdatedAt] = useState<number | undefined>();
  const [inventory, setInventory] = useState<PackageInventory>(emptyInventory());
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<CatalogTab>("installed");

  const load = async () => {
    setLoading(true);
    try {
      const [nextCatalog, nextInventory] = await Promise.all([window.pi.listCatalog(), window.pi.listPackages()]);
      setCatalog(nextCatalog.packages);
      setUpdatedAt(nextCatalog.updatedAt);
      setInventory(nextInventory);
    } catch (error) {
      pushToast("error", error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    return window.pi.onCatalog((packages) => {
      setCatalog(packages);
      setUpdatedAt(Date.now());
    });
  }, []);

  const applyInventory = async (next: PackageInventory) => {
    setInventory(next);
    await refreshModelsAndSessions();
  };

  const run = async (action: () => Promise<PackageInventory | null>, success: string) => {
    setBusy(true);
    try {
      const next = await action();
      if (next) {
        await applyInventory(next);
        pushToast("info", success);
      }
    } catch (error) {
      pushToast("error", error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const refresh = async () => {
    setRefreshing(true);
    try {
      const next = await window.pi.refreshCatalog();
      setCatalog(next.packages);
      setUpdatedAt(next.updatedAt);
      pushToast("info", `目录已开始更新（当前 ${next.packages.length} 个）`);
    } catch (error) {
      pushToast("error", error instanceof Error ? error.message : String(error));
    } finally {
      setRefreshing(false);
    }
  };

  const items = useMemo(() => filterCatalog(catalog, kind, query), [catalog, kind, query]);
  const installed: InstalledResource[] = kind === "extension" ? inventory.extensions : inventory.skills;
  const noun = kind === "extension" ? "扩展" : "Skill";

  return (
    <PageShell>
      <PageHeader
        title={title}
        description={description}
        actions={
          quickActions?.length || actions ? (
            <>
              {quickActions?.map((quick) => (
                <Button key={quick.label} disabled={busy} onClick={() => void run(quick.action, quick.success)}>
                  {quick.label}
                </Button>
              ))}
              {actions}
            </>
          ) : undefined
        }
      />

      <div className="mb-4">
        <CatalogTabs
          tab={tab}
          installedCount={installed.length}
          catalogCount={items.length}
          onChange={setTab}
        />
      </div>

      {tab === "installed" ? (
        loading ? (
          <SkeletonList rows={3} />
        ) : (
          <InstalledToggleList
            title="已安装 / 已发现"
            items={installed}
            busy={busy}
            onBrowse={() => setTab("catalog")}
            onToggle={(item, enabled) =>
              void run(() => window.pi.toggleResource(item, enabled), enabled ? `已启用${noun}` : `已关闭${noun}`)
            }
          />
        )
      ) : (
        <>
          <CatalogToolbar
            count={items.length}
            query={query}
            placeholder={searchPlaceholder}
            updatedAt={updatedAt}
            refreshing={refreshing}
            onQuery={setQuery}
            onRefresh={() => void refresh()}
          />
          {loading ? (
            <SkeletonCards count={4} />
          ) : items.length === 0 ? (
            <EmptyState
              title={refreshing ? "正在从 npm 拉取目录" : `没有匹配的${noun}`}
              description={
                refreshing
                  ? "拉取完成后列表会自动更新，无需刷新界面。"
                  : "目录来自 npm 的 pi-package 关键字，可能尚未缓存或与搜索词不符。"
              }
              action={
                <Button variant="primary" disabled={refreshing} onClick={() => void refresh()}>
                  更新目录
                </Button>
              }
            />
          ) : (
            <CatalogGrid
              items={items}
              busy={busy}
              packages={inventory.packages}
              onInstall={(name) => void run(() => window.pi.installPackage(name), `已安装 ${name}`)}
              onRemove={(source) => void run(() => window.pi.removePackage(source), `已卸载 ${source}`)}
            />
          )}
        </>
      )}
    </PageShell>
  );
}
