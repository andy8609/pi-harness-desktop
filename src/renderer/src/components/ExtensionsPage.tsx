import { useEffect, useMemo, useState } from "react";
import type { CatalogPackage, InstalledResource, PackageInventory } from "@shared/types";
import { refreshModelsAndSessions, useAppStore } from "../stores/app-store";
import { CatalogGrid, CatalogToolbar, InstalledToggleList, emptyInventory, filterCatalog } from "./PackageCatalog";

export function ExtensionsPage() {
  const pushToast = useAppStore((state) => state.pushToast);
  const [catalog, setCatalog] = useState<CatalogPackage[]>([]);
  const [updatedAt, setUpdatedAt] = useState<number | undefined>();
  const [inventory, setInventory] = useState<PackageInventory>(emptyInventory());
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

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

  const items = useMemo(() => filterCatalog(catalog, "extension", query), [catalog, query]);

  return (
    <section className="h-full overflow-auto px-6 py-5">
      <h1 className="text-xl font-semibold">扩展</h1>
      <p className="mt-1 mb-6 text-sm text-[#9a937c]">
        默认读取本地缓存。需要最新列表时点「更新目录」，会从 npm `keywords:pi-package` 重新分页拉取。安装到 ~/.pi/agent，与 CLI `pi install` 一致。
      </p>

      <InstalledToggleList
        title="已安装 / 已发现"
        items={inventory.extensions}
        busy={busy}
        onToggle={(item: InstalledResource, enabled) =>
          void run(() => window.pi.toggleResource(item, enabled), enabled ? "已启用扩展" : "已关闭扩展")
        }
      />

      <CatalogToolbar
        count={items.length}
        query={query}
        placeholder="搜索扩展"
        updatedAt={updatedAt}
        refreshing={refreshing}
        onQuery={setQuery}
        onRefresh={() => void refresh()}
      />
      {loading ? (
        <div className="text-sm text-[#9a937c]">正在读取本地缓存…</div>
      ) : items.length === 0 ? (
        <div className="text-sm text-[#9a937c]">{refreshing ? "正在从 npm 拉取目录…" : "没有匹配的扩展，可点「更新目录」从 npm 获取"}</div>
      ) : (
        <CatalogGrid
          items={items}
          busy={busy}
          packages={inventory.packages}
          onInstall={(name) => void run(() => window.pi.installPackage(name), `已安装 ${name}`)}
          onRemove={(source) => void run(() => window.pi.removePackage(source), `已卸载 ${source}`)}
        />
      )}
    </section>
  );
}
