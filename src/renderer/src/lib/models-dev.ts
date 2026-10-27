import type { ModelDevDefaults, ModelDevQuery } from "@shared/types";

/**
 * 向主进程要 models.dev 的默认元数据。
 *
 * 只用于"填空"，失败就当成没有默认值：不抛错、不打扰用户。
 * 目录解析和缓存都在主进程做，渲染层只拿最终结果，避免把 6MB 的目录搬进页面。
 */
export async function loadModelDefaults(query: ModelDevQuery): Promise<Record<string, ModelDevDefaults>> {
  const invoke = window.pi?.modelsDevDefaults;
  if (typeof invoke !== "function") return {};
  try {
    const result = (await invoke(query)) as Record<string, ModelDevDefaults> | undefined;
    return result && typeof result === "object" ? result : {};
  } catch {
    return {};
  }
}

/** 把模型 id 统一成查默认值用的 key（大小写不敏感）。 */
export function defaultsKey(modelId: string): string {
  return modelId.trim().toLowerCase();
}

export function formatCost(cost?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number }): string | undefined {
  if (!cost) return undefined;
  const parts: string[] = [];
  if (cost.input !== undefined) parts.push(`输入 $${cost.input}`);
  if (cost.output !== undefined) parts.push(`输出 $${cost.output}`);
  if (parts.length === 0) return undefined;
  return `${parts.join(" / ")} 每百万 token`;
}
