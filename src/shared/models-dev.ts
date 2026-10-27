import {
  THINKING_LEVELS,
  orderedThinkingLevels,
  type ModelDevCost,
  type ModelDevDefaults,
  type ModelDevQuery,
  type ThinkingLevel,
} from "./types";

/**
 * models.dev 目录的解析逻辑（纯函数，无 IO）。
 *
 * 主进程负责下载/缓存原始目录，这里负责把它裁剪成小结构、按 provider + 模型 id 匹配，
 * 并转换成 pi models.json 语义的默认值。放在 shared 是为了能被 node 测试直接加载。
 */

/** pi 的模型能力只有这两档，models.dev 的 pdf/video/audio 一律丢弃。 */
const SUPPORTED_INPUTS = ["text", "image"];

export interface CatalogModel {
  id: string;
  name?: string;
  reasoning?: boolean;
  /** reasoning_options 里的 effort 取值（如 low/medium/high）。 */
  efforts?: string[];
  input?: string[];
  context?: number;
  maxOutput?: number;
  cost?: ModelDevCost;
}

export interface CatalogProvider {
  id: string;
  name?: string;
  /** models.dev 的 provider.api 是推荐 baseURL，用来按域名反查 provider。 */
  api?: string;
  models: CatalogModel[];
}

export interface ModelDevCatalog {
  at: number;
  providers: Record<string, CatalogProvider>;
}

/** provider id 常见别名 → models.dev 的 provider key（按优先级排列）。 */
const PROVIDER_HINTS: Record<string, string[]> = {
  openai: ["openai"],
  anthropic: ["anthropic"],
  claude: ["anthropic"],
  google: ["google"],
  gemini: ["google"],
  "google-gemini": ["google"],
  vertex: ["google-vertex"],
  deepseek: ["deepseek"],
  openrouter: ["openrouter"],
  ollama: ["ollama-cloud"],
  "ollama-cloud": ["ollama-cloud"],
  lmstudio: ["lmstudio"],
  zai: ["zai"],
  zhipu: ["zai", "zhipuai"],
  zhipuai: ["zai", "zhipuai"],
  glm: ["zai"],
  moonshot: ["moonshotai"],
  kimi: ["moonshotai"],
  minimax: ["minimax"],
  xai: ["xai"],
  grok: ["xai"],
  groq: ["groq"],
  mistral: ["mistral"],
  siliconflow: ["siliconflow"],
  together: ["togetherai"],
  togetherai: ["togetherai"],
  fireworks: ["fireworks-ai"],
  azure: ["azure"],
  alibaba: ["alibaba"],
  dashscope: ["alibaba"],
  qwen: ["alibaba"],
  stepfun: ["stepfun"],
  volcengine: ["volcengine"],
  doubao: ["volcengine"],
  qianfan: ["qianfan"],
  github: ["github-copilot"],
  copilot: ["github-copilot"],
  perplexity: ["perplexity"],
  cerebras: ["cerebras"],
  sambanova: ["sambanova"],
  novita: ["novita-ai"],
  deepinfra: ["deepinfra"],
  nebius: ["nebius"],
  scaleway: ["scaleway"],
  vultr: ["vultr"],
  baseten: ["baseten"],
  vercel: ["vercel"],
  opencode: ["opencode"],
};

/**
 * 官方 / 直连 provider 的域名 → models.dev key。
 * models.dev 不在 provider 上声 `api` 时（openai / anthropic / google）靠这张表认。
 */
const HOST_HINTS: Record<string, string> = {
  "api.openai.com": "openai",
  "api.anthropic.com": "anthropic",
  "generativelanguage.googleapis.com": "google",
  "aiplatform.googleapis.com": "google-vertex",
  "api.deepseek.com": "deepseek",
  "openrouter.ai": "openrouter",
  "api.z.ai": "zai",
  "open.bigmodel.cn": "zai",
  "api.moonshot.ai": "moonshotai",
  "api.moonshot.cn": "moonshotai",
  "api.minimax.io": "minimax",
  "api.minimaxi.com": "minimax-cn",
  "api.x.ai": "xai",
  "api.groq.com": "groq",
  "api.mistral.ai": "mistral",
  "api.siliconflow.com": "siliconflow",
  "api.siliconflow.cn": "siliconflow-cn",
  "api.together.xyz": "togetherai",
  "api.fireworks.ai": "fireworks-ai",
  "dashscope.aliyuncs.com": "alibaba",
  "dashscope-intl.aliyuncs.com": "alibaba",
  "ark.cn-beijing.volces.com": "volcengine",
  "qianfan.baidubce.com": "qianfan",
  "api.perplexity.ai": "perplexity",
  "api.cerebras.ai": "cerebras",
  "api.sambanova.ai": "sambanova",
  "api.novita.ai": "novita-ai",
  "api.deepinfra.com": "deepinfra",
  "api.nebius.ai": "nebius",
  "api.scaleway.ai": "scaleway",
  "api.vultr.com": "vultr",
  "inference.baseten.co": "baseten",
  "ai-gateway.vercel.sh": "vercel",
  "api.stepfun.com": "stepfun",
  "ollama.com": "ollama-cloud",
};

/**
 * 同一个模型 id 在多个网关重复出现时的优先顺序（只在 provider 没认出来时用）：
 * 先用官方目录里的价格与上下文，而不是转售网关的。
 */
const OFFICIAL_PRIORITY = [
  "openai",
  "anthropic",
  "google",
  "deepseek",
  "xai",
  "mistral",
  "moonshotai",
  "zai",
  "minimax",
  "alibaba",
  "meta",
  "cohere",
  "amazon-bedrock",
  "azure",
  "azure-cognitive-services",
];

/** 本地推理服务器的模型元数据取决于量化与启动参数，云端目录会误导，一律不补。 */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]", "host.docker.internal"]);

export function isLocalBaseUrl(baseUrl?: string): boolean {
  const host = hostOf(baseUrl);
  return Boolean(host && LOCAL_HOSTS.has(host));
}

function hostOf(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url.trim()).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function compactCost(raw: unknown): ModelDevCost | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const record = raw as Record<string, unknown>;
  const cost: ModelDevCost = {};
  const input = finiteNumber(record.input);
  const output = finiteNumber(record.output);
  const cacheRead = finiteNumber(record.cache_read);
  const cacheWrite = finiteNumber(record.cache_write);
  if (input !== undefined) cost.input = input;
  if (output !== undefined) cost.output = output;
  if (cacheRead !== undefined) cost.cacheRead = cacheRead;
  if (cacheWrite !== undefined) cost.cacheWrite = cacheWrite;
  return Object.keys(cost).length > 0 ? cost : undefined;
}

function compactModel(raw: unknown): CatalogModel | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const record = raw as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id.trim() : "";
  if (!id) return undefined;

  const modalities = (record.modalities ?? {}) as { input?: unknown };
  const declared = Array.isArray(modalities.input) ? modalities.input.map(String) : [];
  const input = SUPPORTED_INPUTS.filter((item) => declared.includes(item));

  const limit = (record.limit ?? {}) as { context?: unknown; output?: unknown };
  const efforts: string[] = [];
  if (Array.isArray(record.reasoning_options)) {
    for (const option of record.reasoning_options) {
      if (!option || typeof option !== "object") continue;
      const values = (option as { values?: unknown }).values;
      if (!Array.isArray(values)) continue;
      for (const value of values) if (typeof value === "string") efforts.push(value.toLowerCase());
    }
  }

  return {
    id,
    name: typeof record.name === "string" && record.name.trim() ? record.name.trim() : undefined,
    reasoning: record.reasoning === true,
    efforts: efforts.length > 0 ? efforts : undefined,
    input: input.length > 0 ? input : undefined,
    context: finiteNumber(limit.context),
    maxOutput: finiteNumber(limit.output),
    cost: compactCost(record.cost),
  };
}

/** 把 models.dev 的原始 6MB payload 裁剪成只有查询会用到的字段。 */
export function compactCatalog(raw: unknown, now = Date.now()): ModelDevCatalog {
  const catalog: ModelDevCatalog = { at: now, providers: {} };
  if (!raw || typeof raw !== "object") return catalog;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    const record = value as Record<string, unknown>;
    const models: CatalogModel[] = [];
    if (record.models && typeof record.models === "object") {
      for (const model of Object.values(record.models as Record<string, unknown>)) {
        const compact = compactModel(model);
        if (compact) models.push(compact);
      }
    }
    if (models.length === 0) continue;
    catalog.providers[key.toLowerCase()] = {
      id: key.toLowerCase(),
      name: typeof record.name === "string" ? record.name : undefined,
      api: typeof record.api === "string" ? record.api : undefined,
      models,
    };
  }
  return catalog;
}

function pickProvider(candidates: CatalogProvider[], aliasKeys: string[]): CatalogProvider | undefined {
  if (candidates.length === 0) return undefined;
  if (candidates.length === 1) return candidates[0];
  // 多个同域名的网关时，优先别名表顺序，再按 provider key 长度（越短越"官方"）。
  for (const key of aliasKeys) {
    const hit = candidates.find((provider) => provider.id === key);
    if (hit) return hit;
  }
  return [...candidates].sort((a, b) => a.id.length - b.id.length)[0];
}

/** 依次用 providerId → 别名 → baseUrl 域名 → 显示名匹配 models.dev 的 provider。 */
export function matchProvider(catalog: ModelDevCatalog, query: ModelDevQuery): CatalogProvider | undefined {
  const providers = Object.values(catalog.providers);
  const aliasKeys = query.providerId?.trim().toLowerCase()
    ? (PROVIDER_HINTS[query.providerId.trim().toLowerCase()] ?? [])
    : [];

  for (const key of [query.providerId?.trim().toLowerCase(), ...aliasKeys]) {
    if (!key) continue;
    const hit = catalog.providers[key];
    if (hit) return hit;
  }

  const host = hostOf(query.baseUrl);
  if (host) {
    // 1) 本地服务器：不套云端元数据
    if (LOCAL_HOSTS.has(host)) return undefined;
    // 2) 域名提示表（openai / anthropic 这类没有 provider.api 的也能认）
    const hinted = HOST_HINTS[host];
    if (hinted && catalog.providers[hinted]) return catalog.providers[hinted];
    // 3) 按 provider.api 里声明的 baseURL 反查
    const hits = providers.filter((provider) => hostOf(provider.api) === host);
    const picked = pickProvider(hits, aliasKeys);
    if (picked) return picked;
  }

  const name = query.name?.trim().toLowerCase();
  if (name) {
    const hits = providers.filter((provider) => (provider.name ?? "").toLowerCase() === name);
    const picked = pickProvider(hits, aliasKeys);
    if (picked) return picked;
  }
  return undefined;
}

export function modelKeyVariants(modelId: string): string[] {
  const lower = modelId.trim().toLowerCase();
  if (!lower) return [];
  const tail = lower.slice(lower.lastIndexOf("/") + 1);
  const variants = new Set<string>([lower, tail]);
  // `deepseek-chat:free` / `gpt-5@2025-08-07` 这类网关后缀
  for (const value of [lower, tail]) {
    const colon = value.split(":")[0];
    if (colon) variants.add(colon);
    const at = value.split("@")[0];
    if (at) variants.add(at);
  }
  variants.delete("");
  return [...variants];
}

/** 模型 id 精确 → 去 vendor 前缀/网关后缀 → 唯一前缀匹配。 */
export function matchModel(provider: CatalogProvider, modelId: string): CatalogModel | undefined {
  const variants = modelKeyVariants(modelId);
  if (variants.length === 0) return undefined;
  const byId = new Map<string, CatalogModel>();
  for (const model of provider.models) byId.set(model.id.toLowerCase(), model);

  for (const variant of variants) {
    const hit = byId.get(variant);
    if (hit) return hit;
  }

  // 网关常截断模型名（claude-sonnet-4 vs claude-sonnet-4-20250514），只在唯一时采用。
  const needle = variants[variants.length - 1] ?? "";
  if (needle.length < 4) return undefined;
  const fuzzy = provider.models.filter((model) => {
    const id = model.id.toLowerCase();
    return id.startsWith(needle) || needle.startsWith(id);
  });
  return fuzzy.length === 1 ? fuzzy[0] : undefined;
}

/** reasoning_options → pi 的思考档位；只有开/关的模型给"关 / 高"两档。 */
export function thinkingLevelsFor(model: CatalogModel): ThinkingLevel[] {
  if (!model.reasoning) return [];
  const efforts = (model.efforts ?? [])
    .map((value) => value.toLowerCase())
    .filter((value): value is ThinkingLevel => (THINKING_LEVELS as string[]).includes(value));
  if (efforts.length === 0) return ["off", "high"];
  return orderedThinkingLevels(["off", ...efforts]);
}

/**
 * pi 的 cost schema 里 input/output/cacheRead/cacheWrite 全部必填（`Type.Number()`），
 * 缺一项会让**整个 models.json** 被判无效（所有自定义模型消失）。
 * models.dev 常常不给 cache_write（甚至只给 input/output），这里统一补 0。
 */
function completeCost(cost: ModelDevCost): ModelDevCost {
  return {
    input: cost.input ?? 0,
    output: cost.output ?? 0,
    cacheRead: cost.cacheRead ?? 0,
    cacheWrite: cost.cacheWrite ?? 0,
  };
}

function pickDefaultThinkingLevel(levels: ThinkingLevel[]): ThinkingLevel | null {
  if (levels.length === 0) return null;
  if (levels.includes("medium")) return "medium";
  const on = levels.filter((level) => level !== "off");
  return on[Math.floor((on.length - 1) / 2)] ?? null;
}

export function buildDefaults(model: CatalogModel, source: string): ModelDevDefaults {
  const thinkingLevels = thinkingLevelsFor(model);
  return {
    id: model.id,
    ...(model.name ? { name: model.name } : {}),
    ...(model.context ? { contextWindow: model.context } : {}),
    ...(model.maxOutput ? { maxTokens: model.maxOutput } : {}),
    ...(model.reasoning ? { reasoning: true } : {}),
    ...(model.input ? { input: model.input } : {}),
    ...(thinkingLevels.length > 0
      ? {
          thinkingLevels,
          defaultThinkingLevel: pickDefaultThinkingLevel(thinkingLevels),
        }
      : {}),
    ...(model.cost ? { cost: completeCost(model.cost) } : {}),
    source,
  };
}

/** 目录里没匹配到 provider 时的兜底：全局按模型 id 找唯一归属。 */
function globalModelIndex(catalog: ModelDevCatalog): Map<
  string,
  Array<{ provider: CatalogProvider; model: CatalogModel }>
> {
  const index = new Map<string, Array<{ provider: CatalogProvider; model: CatalogModel }>>();
  for (const provider of Object.values(catalog.providers)) {
    for (const model of provider.models) {
      const key = model.id.toLowerCase();
      const bucket = index.get(key);
      if (bucket) bucket.push({ provider, model });
      else index.set(key, [{ provider, model }]);
    }
  }
  return index;
}

/** 全局兜底时从多个命中里选一个：只信厂商自己的目录，剩下的手器价格/上下文不可靠。 */
function pickGlobalHit(hits: Array<{ provider: CatalogProvider; model: CatalogModel }>) {
  const unique = [...new Map(hits.map((hit) => [`${hit.provider.id}/${hit.model.id}`, hit])).values()];
  for (const id of OFFICIAL_PRIORITY) {
    const hit = unique.find((entry) => entry.provider.id === id);
    if (hit) return hit;
  }
  // 例：deepseek-chat 在官方目录已下线、只剩转售网关时，宁可不补也不拿错价格。
  return undefined;
}

/**
 * 批量解析模型默认值。返回 key 为调用方传入的模型 id（原样），查不到的 id 不出现在结果里。
 */
export function resolveDefaults(
  catalog: ModelDevCatalog,
  query: ModelDevQuery,
): Record<string, ModelDevDefaults> {
  const result: Record<string, ModelDevDefaults> = {};
  const ids = [...new Set((query.modelIds ?? []).map((id) => id.trim()).filter(Boolean))];
  if (ids.length === 0) return result;
  // 本地 vLLM / Ollama / LM Studio：模型参数由本地决定，不套云端默认值
  if (isLocalBaseUrl(query.baseUrl)) return result;

  const provider = matchProvider(catalog, query);
  const uncovered: string[] = [];
  for (const id of ids) {
    const model = provider ? matchModel(provider, id) : undefined;
    if (!model || !provider) {
      uncovered.push(id);
      continue;
    }
    result[id] = buildDefaults(model, `models.dev/${provider.id}`);
  }

  if (uncovered.length === 0) return result;
  const index = globalModelIndex(catalog);
  for (const id of uncovered) {
    const hit = pickGlobalHit(modelKeyVariants(id).flatMap((variant) => index.get(variant) ?? []));
    if (!hit) continue;
    result[id] = buildDefaults(hit.model, `models.dev/${hit.provider.id}`);
  }
  return result;
}
