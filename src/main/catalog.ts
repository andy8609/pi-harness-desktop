import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { CatalogKind, CatalogPackage } from "@shared/types";

const SEARCH_SIZE = 250;
const PAGE_GAP_MS = 400;
const SEARCH_ENDPOINTS = [
  "https://registry.npmjs.org/-/v1/search",
  "https://registry.npmjs.com/-/v1/search",
];
const HEADERS = {
  Accept: "application/json",
  "User-Agent": "pi-desktop/0.1 (+https://pi.dev)",
};

interface NpmSearchPackage {
  name?: string;
  version?: string;
  description?: string;
  keywords?: string[];
  links?: { npm?: string };
}

interface NpmSearchResponse {
  objects?: Array<{ package?: NpmSearchPackage }>;
  total?: number;
}

interface CatalogCache {
  at: number;
  packages: CatalogPackage[];
  total?: number;
}

type CatalogListener = (packages: CatalogPackage[]) => void;

let memoryCache: CatalogCache | undefined;
let inflight: Promise<CatalogPackage[]> | undefined;
let firstPagePromise: Promise<CatalogPackage[]> | undefined;
let resolveFirstPage: ((packages: CatalogPackage[]) => void) | undefined;
let rejectFirstPage: ((error: unknown) => void) | undefined;
let listener: CatalogListener | undefined;

export function setCatalogListener(next: CatalogListener | undefined): void {
  listener = next;
}

function cachePath(): string {
  return join(getAgentDir(), "desktop-catalog-cache.json");
}

function classifyKinds(keywords: string[]): CatalogKind[] {
  const lowered = keywords.map((keyword) => keyword.toLowerCase());
  const hasExtension = lowered.some((keyword) => keyword.includes("extension"));
  const hasSkill = lowered.some((keyword) => keyword.includes("skill"));
  const kinds: CatalogKind[] = [];
  if (hasExtension || (!hasExtension && !hasSkill)) kinds.push("extension");
  if (hasSkill) kinds.push("skill");
  return kinds;
}

function hasPiPackageKeyword(keywords: string[]): boolean {
  return keywords.some((keyword) => keyword.toLowerCase() === "pi-package");
}

function toCatalogPackage(pkg: NpmSearchPackage): CatalogPackage | undefined {
  if (!pkg.name) return undefined;
  const keywords = pkg.keywords ?? [];
  if (!hasPiPackageKeyword(keywords)) return undefined;
  return {
    name: pkg.name,
    version: pkg.version ?? "",
    description: pkg.description ?? "",
    keywords,
    kinds: classifyKinds(keywords),
    npmUrl: pkg.links?.npm ?? `https://www.npmjs.com/package/${pkg.name}`,
  };
}

function readDiskCache(): CatalogCache | undefined {
  const path = cachePath();
  if (!existsSync(path)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as CatalogCache;
    if (!parsed.at || !Array.isArray(parsed.packages) || parsed.packages.length === 0) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

function writeDiskCache(cache: CatalogCache): void {
  mkdirSync(getAgentDir(), { recursive: true });
  writeFileSync(cachePath(), JSON.stringify(cache, null, 2), "utf8");
}

function publish(packages: CatalogPackage[], total?: number): void {
  memoryCache = {
    at: Date.now(),
    packages,
    total: total ?? memoryCache?.total,
  };
  writeDiskCache(memoryCache);
  listener?.(packages);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mergePackages(existing: CatalogPackage[], incoming: CatalogPackage[]): CatalogPackage[] {
  const map = new Map(existing.map((item) => [item.name, item]));
  for (const item of incoming) map.set(item.name, item);
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}

async function fetchSearchPage(baseUrl: string, from: number): Promise<NpmSearchResponse> {
  const url = `${baseUrl}?text=${encodeURIComponent("keywords:pi-package")}&size=${SEARCH_SIZE}&from=${from}`;
  let delay = 2000;
  let lastError: Error | undefined;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await fetch(url, { headers: HEADERS });
    if (response.ok) return (await response.json()) as NpmSearchResponse;
    lastError = new Error(`npm 目录请求失败 (${response.status})`);
    if (response.status !== 429 && response.status < 500) throw lastError;
    const retryAfter = Number(response.headers.get("retry-after"));
    await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : delay);
    delay = Math.min(delay * 2, 20000);
  }
  throw lastError ?? new Error("npm 目录请求失败");
}

async function fetchPage(from: number): Promise<NpmSearchResponse> {
  let lastError: unknown;
  for (const endpoint of SEARCH_ENDPOINTS) {
    try {
      return await fetchSearchPage(endpoint, from);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("npm 目录请求失败");
}

function collectPage(objects: Array<{ package?: NpmSearchPackage }>): CatalogPackage[] {
  const packages: CatalogPackage[] = [];
  const seen = new Set<string>();
  for (const object of objects) {
    const item = object.package ? toCatalogPackage(object.package) : undefined;
    if (!item || seen.has(item.name)) continue;
    seen.add(item.name);
    packages.push(item);
  }
  return packages;
}

async function fetchAllFromNpm(): Promise<CatalogPackage[]> {
  try {
    const first = await fetchPage(0);
    let packages = collectPage(first.objects ?? []);
    if (packages.length === 0) throw new Error("npm 目录为空");
    const total = typeof first.total === "number" ? first.total : packages.length;
    publish(packages, total);
    resolveFirstPage?.(packages);
    resolveFirstPage = undefined;
    rejectFirstPage = undefined;

    for (let from = SEARCH_SIZE; from < total; from += SEARCH_SIZE) {
      await sleep(PAGE_GAP_MS);
      try {
        const page = await fetchPage(from);
        const chunk = collectPage(page.objects ?? []);
        if (chunk.length === 0) break;
        packages = mergePackages(packages, chunk);
        publish(packages, total);
        if ((page.objects ?? []).length < SEARCH_SIZE) break;
      } catch {
        break;
      }
    }
    return packages;
  } catch (error) {
    rejectFirstPage?.(error);
    resolveFirstPage = undefined;
    rejectFirstPage = undefined;
    throw error;
  }
}

function cachedPackages(): CatalogCache | undefined {
  if (memoryCache?.packages.length) return memoryCache;
  const disk = readDiskCache();
  if (!disk) return undefined;
  memoryCache = disk;
  return disk;
}

function startFetch(): Promise<CatalogPackage[]> {
  if (inflight) return inflight;
  firstPagePromise = new Promise<CatalogPackage[]>((resolve, reject) => {
    resolveFirstPage = resolve;
    rejectFirstPage = reject;
  });
  inflight = fetchAllFromNpm()
    .catch((error) => {
      const stale = cachedPackages()?.packages ?? memoryCache?.packages;
      if (stale && stale.length > 0) {
        resolveFirstPage?.(stale);
        return stale;
      }
      throw error instanceof Error ? error : new Error("无法拉取 pi-package 目录");
    })
    .finally(() => {
      inflight = undefined;
    });
  return inflight;
}

export function catalogUpdatedAt(): number | undefined {
  return cachedPackages()?.at;
}

export async function fetchPiPackages(force = false): Promise<CatalogPackage[]> {
  const cached = cachedPackages();
  if (!force && cached?.packages.length) return cached.packages;

  startFetch();
  return firstPagePromise ?? inflight ?? Promise.resolve(cached?.packages ?? []);
}
