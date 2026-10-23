import { useEffect, useMemo, useState } from "react";
import type { CatalogPackage, InstalledResource, PackageInventory } from "@shared/types";
import { refreshModelsAndSessions, useAppStore } from "../stores/app-store";
import { CatalogGrid, CatalogToolbar, InstalledToggleList, emptyInventory, filterCatalog } from "./PackageCatalog";

export function SkillsPage() {
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

  const items = useMemo(() => filterCatalog(catalog, "skill", query), [catalog, query]);

  return (
    <section className="h-full overflow-auto px-6 py-5">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Skills</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            默认读取本地缓存。可点「更新目录」从 npm 重新拉取，或导入本地 SKILL.md / 技能目录。
          </p>
        </div>
        <div className="flex gap-2">
          <button
            className="rounded border border-[var(--line)] px-3 py-1.5 text-sm disabled:opacity-50"
            disabled={busy}
            onClick={() => void run(() => window.pi.importSkillFile(), "已导入本地 Skill 文件")}
          >
            导入 SKILL.md
          </button>
          <button
            className="rounded border border-[var(--line)] px-3 py-1.5 text-sm disabled:opacity-50"
            disabled={busy}
            onClick={() => void run(() => window.pi.importSkillDir(), "已导入本地 Skill 目录")}
          >
            导入目录
          </button>
        </div>
      </div>

      <InstalledToggleList
        title="已安装 / 已发现"
        items={inventory.skills}
        busy={busy}
        onToggle={(item: InstalledResource, enabled) =>
          void run(() => window.pi.toggleResource(item, enabled), enabled ? "已启用 Skill" : "已关闭 Skill")
        }
      />

      <CatalogToolbar
        count={items.length}
        query={query}
        placeholder="搜索 Skills"
        updatedAt={updatedAt}
        refreshing={refreshing}
        onQuery={setQuery}
        onRefresh={() => void refresh()}
      />
      {loading ? (
        <div className="text-sm text-[var(--muted)]">正在读取本地缓存…</div>
      ) : items.length === 0 ? (
        <div className="text-sm text-[var(--muted)]">{refreshing ? "正在从 npm 拉取目录…" : "没有匹配的 Skills，可点「更新目录」从 npm 获取"}</div>
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
