function resolveApiKey(apiKey) {
    if (!apiKey)
        return undefined;
    if (apiKey.startsWith("$"))
        return process.env[apiKey.slice(1)] || undefined;
    return apiKey;
}
function normalizeBase(baseUrl) {
    return baseUrl.trim().replace(/\/+$/, "");
}
function collectIds(payload) {
    if (!payload || typeof payload !== "object")
        return [];
    const record = payload;
    const rows = Array.isArray(record.data)
        ? record.data
        : Array.isArray(record.models)
            ? record.models
            : Array.isArray(payload)
                ? payload
                : [];
    const models = [];
    const seen = new Set();
    for (const row of rows) {
        if (!row || typeof row !== "object")
            continue;
        const item = row;
        const id = String(item.id ?? item.name ?? item.model ?? "").trim();
        if (!id || seen.has(id))
            continue;
        seen.add(id);
        models.push({
            id,
            name: typeof item.name === "string" && item.name !== id ? item.name : undefined,
        });
    }
    return models.sort((a, b) => a.id.localeCompare(b.id));
}
async function fetchJson(url, apiKey) {
    const headers = { Accept: "application/json" };
    if (apiKey)
        headers.Authorization = `Bearer ${apiKey}`;
    const response = await fetch(url, { headers });
    if (!response.ok) {
        throw new Error(`拉取模型列表失败 (${response.status}) ${url}`);
    }
    return response.json();
}
export async function listRemoteModels(baseUrl, apiKey) {
    const root = normalizeBase(baseUrl);
    if (!root)
        throw new Error("请先填写 Base URL");
    const key = resolveApiKey(apiKey);
    const candidates = [`${root}/models`];
    if (root.endsWith("/v1")) {
        candidates.push(`${root.slice(0, -3)}/api/tags`);
    }
    else {
        candidates.push(`${root}/api/tags`);
    }
    let lastError;
    for (const url of candidates) {
        try {
            const models = collectIds(await fetchJson(url, key));
            if (models.length > 0)
                return models;
        }
        catch (error) {
            lastError = error;
        }
    }
    throw new Error(lastError instanceof Error ? lastError.message : "未能从该地址获取模型列表");
}
