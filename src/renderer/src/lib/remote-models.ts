export interface RemoteModel {
  id: string;
  name?: string;
}

function collectIds(payload: unknown): RemoteModel[] {
  if (!payload || typeof payload !== "object") return [];
  const record = payload as Record<string, unknown>;
  const rows = Array.isArray(record.data)
    ? record.data
    : Array.isArray(record.models)
      ? record.models
      : Array.isArray(payload)
        ? payload
        : [];
  const models: RemoteModel[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const item = row as Record<string, unknown>;
    const id = String(item.id ?? item.name ?? item.model ?? "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    models.push({
      id,
      name: typeof item.name === "string" && item.name !== id ? item.name : undefined,
    });
  }
  return models.sort((a, b) => a.id.localeCompare(b.id));
}

async function fetchFromRenderer(baseUrl: string, apiKey?: string): Promise<RemoteModel[]> {
  const root = baseUrl.trim().replace(/\/+$/, "");
  if (!root) throw new Error("请先填写 Base URL");
  const headers: Record<string, string> = { Accept: "application/json" };
  if (apiKey && !apiKey.startsWith("$")) headers.Authorization = `Bearer ${apiKey}`;
  const candidates = [`${root}/models`];
  if (root.endsWith("/v1")) candidates.push(`${root.slice(0, -3)}/api/tags`);
  else candidates.push(`${root}/api/tags`);

  let lastError: unknown;
  for (const url of candidates) {
    try {
      const response = await fetch(url, { headers });
      if (!response.ok) {
        lastError = new Error(`拉取模型列表失败 (${response.status})`);
        continue;
      }
      const models = collectIds(await response.json());
      if (models.length > 0) return models;
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(lastError instanceof Error ? lastError.message : "未能从该地址获取模型列表");
}

export async function listRemoteModels(baseUrl: string, apiKey?: string): Promise<RemoteModel[]> {
  const preload = window.pi.listRemoteModels;
  if (typeof preload === "function") {
    try {
      return await preload(baseUrl, apiKey);
    } catch (error) {
      try {
        return await fetchFromRenderer(baseUrl, apiKey);
      } catch {
        throw error;
      }
    }
  }
  return fetchFromRenderer(baseUrl, apiKey);
}
