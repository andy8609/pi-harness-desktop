import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import {
  compactCatalog,
  resolveDefaults,
  type ModelDevCatalog,
} from "@shared/models-dev";
import type { ModelDevDefaults, ModelDevQuery } from "@shared/types";

/**
 * models.dev 目录客户端：给自定义 provider 的模型补默认元数据。
 *
 * 只做"填空"：调用方拿到结果后自己决定哪些字段是空的。
 * 目录是 6MB 级的公共数据，所以拉取后裁剪（见 shared/models-dev）再落盘缓存，TTL 7 天。
 */

const CATALOG_URL = "https://models.dev/api.json";
const CACHE_FILE = "desktop-models-dev-cache.json";
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 20_000;

let memory: ModelDevCatalog | undefined;
let inflight: Promise<ModelDevCatalog | undefined> | undefined;

function cachePath(): string {
  return join(getAgentDir(), CACHE_FILE);
}

function readDiskCache(): ModelDevCatalog | undefined {
  const path = cachePath();
  if (!existsSync(path)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as ModelDevCatalog;
    if (!parsed || typeof parsed.at !== "number" || !parsed.providers) return undefined;
    if (Object.keys(parsed.providers).length === 0) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

function writeDiskCache(catalog: ModelDevCatalog): void {
  try {
    mkdirSync(getAgentDir(), { recursive: true });
    writeFileSync(cachePath(), JSON.stringify(catalog), "utf8");
  } catch {
    // 缓存写不进去不影响本次查询结果
  }
}

async function fetchCatalog(): Promise<ModelDevCatalog> {
  const response = await fetch(CATALOG_URL, {
    headers: { Accept: "application/json", "User-Agent": "pi-desktop (+https://pi.dev)" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`models.dev 请求失败 (${response.status})`);
  const catalog = compactCatalog(await response.json());
  if (Object.keys(catalog.providers).length === 0) throw new Error("models.dev 返回的目录为空");
  writeDiskCache(catalog);
  return catalog;
}

/** 内存 → 磁盘（7 天内直接信）→ 网络；网络失败时退回任意旧缓存，离线也能补默认值。 */
export async function loadCatalog(): Promise<ModelDevCatalog | undefined> {
  if (memory) return memory;
  const disk = readDiskCache();
  if (disk && Date.now() - disk.at < CACHE_TTL_MS) {
    memory = disk;
    return memory;
  }
  if (!inflight) {
    inflight = fetchCatalog()
      .then((catalog) => {
        memory = catalog;
        return catalog;
      })
      .catch(() => disk)
      .finally(() => {
        inflight = undefined;
      });
  }
  return inflight;
}

export function clearModelsDevCache(): void {
  memory = undefined;
}

/** IPC 入口：拉目录 + 解析；目录不可用时返回空对象（默认值只是辅助，不阻断保存）。 */
export async function modelDevDefaults(query: ModelDevQuery): Promise<Record<string, ModelDevDefaults>> {
  const catalog = await loadCatalog();
  if (!catalog) return {};
  return resolveDefaults(catalog, query);
}
