import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { CustomProviderConfig, ModelsFile } from "@shared/types";

/** Official OpenAI-style gateways that actually accept reasoning_effort / store / max_completion_tokens. */
const OFFICIAL_OPENAI_COMPAT_HOSTS = [
  "api.openai.com",
  "openrouter.ai",
];

function hostnameOf(baseUrl?: string): string | undefined {
  if (!baseUrl) return undefined;
  try {
    return new URL(baseUrl).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

export function isOfficialOpenAICompatHost(baseUrl?: string): boolean {
  const host = hostnameOf(baseUrl);
  if (!host) return false;
  if (OFFICIAL_OPENAI_COMPAT_HOSTS.includes(host)) return true;
  if (host.endsWith(".openai.com") || host.endsWith(".openrouter.ai")) return true;
  if (host.endsWith(".azure.com") || host.endsWith(".cognitiveservices.azure.com")) return true;
  return false;
}

function usesOpenAiCompletions(provider: CustomProviderConfig): boolean {
  if (provider.api === "openai-completions") return true;
  const models = provider.models ?? [];
  if (models.some((model) => model.api === "openai-completions")) return true;
  return !provider.api && models.some((model) => !model.api);
}

/**
 * 未知 OpenAI 兼容网关（IPSA/Thor 等）不要默认带 store / developer 角色。
 * 思考格式和 max_tokens 字段因模型而异，不能写在 provider 上。
 */
export const SAFE_CUSTOM_OPENAI_COMPAT: Record<string, unknown> = {
  supportsStore: false,
  supportsDeveloperRole: false,
  supportsUsageInStreaming: false,
};

/** 请求体里最大输出 token 的字段名，pi 只支持这两种。 */
export type MaxTokensField = "max_tokens" | "max_completion_tokens";

/**
 * 明确要求 `max_completion_tokens` 的新式模型（OpenAI gpt/o 系列及同源网关）。
 * 这些模型对 `max_tokens` 直接返回 400 unsupported_parameter，必须强制纠正。
 */
const COMPLETION_TOKENS_MODEL_HINTS = ["gpt", "o1", "o3", "o4", "luna", "codex", "chatgpt"];

/** 仍使用 `max_tokens` 的老式模型：只补空缺，不覆盖用户的显式配置。 */
const LEGACY_MAX_TOKENS_MODEL_HINTS = ["deepseek", "glm", "chatglm", "qwen", "qwq", "moonshot", "kimi"];

function idLooksLike(modelId: string, ...needles: string[]): boolean {
  const id = modelId.toLowerCase();
  return needles.some((needle) => id.includes(needle));
}

export function isMaxTokensField(value: unknown): value is MaxTokensField {
  return value === "max_tokens" || value === "max_completion_tokens";
}

/**
 * 按模型 id 判定该用哪个 max tokens 字段名。
 * 返回 undefined 表示无法判定，交给 pi 的网关自动检测（默认 max_completion_tokens）。
 */
export function preferredMaxTokensField(modelId: string): MaxTokensField | undefined {
  const id = modelId.toLowerCase();
  if (id.startsWith("zai") || idLooksLike(id, ...LEGACY_MAX_TOKENS_MODEL_HINTS)) return "max_tokens";
  if (idLooksLike(id, ...COMPLETION_TOKENS_MODEL_HINTS)) return "max_completion_tokens";
  return undefined;
}

/** 按模型 id 推断网关该怎么发思考 / max tokens，只填用户没写过的键。 */
export function inferCustomModelCompat(modelId: string): Record<string, unknown> {
  const maxTokensField = preferredMaxTokensField(modelId);
  if (idLooksLike(modelId, "deepseek")) {
    return {
      thinkingFormat: "deepseek",
      supportsReasoningEffort: false,
      maxTokensField,
      requiresReasoningContentOnAssistantMessages: true,
    };
  }
  if (idLooksLike(modelId, "glm", "chatglm") || modelId.toLowerCase().startsWith("zai")) {
    return {
      thinkingFormat: "zai",
      supportsReasoningEffort: false,
      maxTokensField,
    };
  }
  if (idLooksLike(modelId, "qwen", "qwq")) {
    return {
      thinkingFormat: "qwen",
      supportsReasoningEffort: false,
      maxTokensField,
    };
  }
  if (maxTokensField === "max_completion_tokens") {
    return { maxTokensField };
  }
  return {};
}

/**
 * 解析某模型最终应使用的 max tokens 字段名。
 * 优先级：已知新式模型（强制新字段）> 模型级显式配置 > provider 级显式配置 > 推断值。
 */
export function maxTokensFieldForModel(file: ModelsFile, modelId: string): MaxTokensField | undefined {
  const preferred = preferredMaxTokensField(modelId);
  // gpt/o 系列对 max_tokens 一律 400，必须无条件使用新字段。
  if (preferred === "max_completion_tokens") return preferred;
  for (const provider of Object.values(file.providers ?? {})) {
    const model = provider.models?.find((entry) => entry.id === modelId);
    if (!model) continue;
    if (isMaxTokensField(model.compat?.maxTokensField)) return model.compat?.maxTokensField;
    if (isMaxTokensField(provider.compat?.maxTokensField)) return provider.compat?.maxTokensField;
  }
  return preferred;
}

/**
 * models.json 里是否已经存在该模型的配置；存在时把它的 maxTokensField 强制写成新字段名。
 * 用于 400 兜底：需要落盘修正，下次启动也不会再犯。
 */
export function forceMaxCompletionTokensField(file: ModelsFile, modelId: string): boolean {
  let changed = false;
  for (const provider of Object.values(file.providers ?? {})) {
    const model = provider.models?.find((entry) => entry.id === modelId);
    if (!model) continue;
    const compat = { ...(model.compat ?? {}) };
    if (compat.maxTokensField === "max_completion_tokens") continue;
    compat.maxTokensField = "max_completion_tokens";
    model.compat = compat;
    changed = true;
  }
  return changed;
}

/** 服务端 400：显式说明 max_tokens 不被支持、要用 max_completion_tokens。 */
export function isMaxTokensFieldUnsupportedError(message?: string): boolean {
  if (!message) return false;
  const text = message.toLowerCase();
  if (!text.includes("max_tokens")) return false;
  return (
    text.includes("max_completion_tokens") ||
    text.includes("unsupported_parameter") ||
    text.includes("unsupported parameter")
  );
}

/**
 * 服务端 400：`chat/completions` 下 function tools 与 reasoning_effort 不能共存。
 * 原文示例：Function tools with reasoning_effort are not supported for gpt-5.6-luna in
 * /v1/chat/completions. To use function tools, use /v1/responses or set reasoning_effort to 'none'.
 */
export function isReasoningEffortToolsUnsupportedError(message?: string): boolean {
  if (!message) return false;
  const text = message.toLowerCase();
  if (!text.includes("reasoning_effort")) return false;
  const mentionsTools = text.includes("function tools") || text.includes("tools with reasoning") || text.includes("tools and reasoning");
  if (!mentionsTools) return false;
  return text.includes("/v1/responses") || text.includes("not supported") || text.includes("unsupported");
}

/**
 * 非官方网关上的 luna 族模型不接受 `minimal` 思考档（官方 OpenAI / 部分网关支持）。
 * 补上 thinkingLevelMap.minimal → low，避免选"最低"时返回 400 unsupported_value。
 */
export function applyReasoningLevelOverrides(file: ModelsFile): boolean {
  let changed = false;
  for (const provider of Object.values(file.providers ?? {})) {
    const officialHost = isOfficialOpenAICompatHost(provider.baseUrl);
    for (const model of provider.models ?? []) {
      if (!model.reasoning || officialHost) continue;
      if (!idLooksLike(model.id, "luna")) continue;
      const map = { ...(model.thinkingLevelMap ?? {}) };
      if (map.minimal !== undefined) continue;
      map.minimal = "low";
      model.thinkingLevelMap = map;
      changed = true;
    }
  }
  return changed;
}

/**
 * `chat/completions` 下 function tools 与 reasoning_effort 互斥的模型（luna 族）：
 * 自定义网关上只要开了思考，就在配置阶段直接切到 openai-responses，
 * 避免 UI 重新配置后丢掉模型级 api，每次都要等一次 400 才被兜底修正。
 *
 * 例外：compat.supportsReasoningEffort === false 表示兜底已判定该网关
 * 没有 /responses 并降级（或用户显式关闭思考），此时不能再切回去，否则会反复翻转。
 */
export function applyModelApiOverrides(file: ModelsFile): boolean {
  let changed = false;
  for (const provider of Object.values(file.providers ?? {})) {
    if (isOfficialOpenAICompatHost(provider.baseUrl)) continue;
    for (const model of provider.models ?? []) {
      if (!model.reasoning) continue;
      if (!idLooksLike(model.id, "luna")) continue;
      if (model.compat?.supportsReasoningEffort === false) continue;
      const current = model.api ?? provider.api;
      if (current === "openai-responses") continue;
      // 用户显式选了其它 API 风格（anthropic 等）时不干预。
      if (current && current !== "openai-completions") continue;
      model.api = "openai-responses";
      changed = true;
    }
  }
  return changed;
}

/** 配置显式声明该模型不支持 reasoning_effort 时，请求体里不应出现这个参数。 */
export function reasoningEffortDisabledForModel(file: ModelsFile, modelId: string): boolean {
  for (const provider of Object.values(file.providers ?? {})) {
    const model = provider.models?.find((entry) => entry.id === modelId);
    if (!model) continue;
    return model.compat?.supportsReasoningEffort === false;
  }
  return false;
}

/** 把某模型的 API 风格改成指定值（如把它从 chat/completions 切到 responses）。 */
export function setModelApi(file: ModelsFile, modelId: string, api: string): boolean {
  let changed = false;
  for (const provider of Object.values(file.providers ?? {})) {
    for (const model of provider.models ?? []) {
      if (model.id !== modelId || model.api === api) continue;
      model.api = api;
      changed = true;
    }
  }
  return changed;
}

/** 写入某模型 compat 的单个键，返回是否真的发生了变更。 */
export function setModelCompatValue(file: ModelsFile, modelId: string, key: string, value: unknown): boolean {
  let changed = false;
  for (const provider of Object.values(file.providers ?? {})) {
    for (const model of provider.models ?? []) {
      if (model.id !== modelId) continue;
      const compat = { ...(model.compat ?? {}) };
      if (compat[key] === value) continue;
      compat[key] = value;
      model.compat = compat;
      changed = true;
    }
  }
  return changed;
}

function mergeMissing(target: Record<string, unknown>, source: Record<string, unknown>): boolean {
  let changed = false;
  for (const [key, value] of Object.entries(source)) {
    if (target[key] === undefined) {
      target[key] = value;
      changed = true;
    }
  }
  return changed;
}

/**
 * 模型级 max tokens 字段纠正：与网关是否为官方 host 无关。
 * 只要模型 id 属于已知新式模型，就强制使用 `max_completion_tokens`，
 * 避免 models.json 里残留的 `max_tokens` 每轮请求都触发 400。
 */
export function applyMaxTokensFieldOverrides(file: ModelsFile): boolean {
  let changed = false;
  for (const provider of Object.values(file.providers ?? {})) {
    for (const model of provider.models ?? []) {
      if (preferredMaxTokensField(model.id) !== "max_completion_tokens") continue;
      if (model.compat?.maxTokensField === "max_completion_tokens") continue;
      model.compat = { ...(model.compat ?? {}), maxTokensField: "max_completion_tokens" };
      changed = true;
    }
  }
  return changed;
}

export function applySafeCustomOpenAiCompat(file: ModelsFile): { file: ModelsFile; changed: boolean } {
  const providers = file.providers ?? {};
  // 三项都要执行，不能用 || 短路：前面的修正返回 true 会跳过后面的。
  const maxTokensChanged = applyMaxTokensFieldOverrides(file);
  const reasoningChanged = applyReasoningLevelOverrides(file);
  const apiChanged = applyModelApiOverrides(file);
  let changed = maxTokensChanged || reasoningChanged || apiChanged;
  for (const provider of Object.values(providers)) {
    if (!usesOpenAiCompletions(provider)) continue;
    if (isOfficialOpenAICompatHost(provider.baseUrl)) continue;
    const next = { ...(provider.compat ?? {}) };
    if (mergeMissing(next, SAFE_CUSTOM_OPENAI_COMPAT)) changed = true;
    // 旧逻辑把 max_tokens 写在整个 provider 上，GPT 类模型会 400。
    if (next.maxTokensField === "max_tokens") {
      delete next.maxTokensField;
      changed = true;
    }
    // 思考格式改按模型写，provider 上的 false 会挡住 DeepSeek 的 thinking 字段。
    if (next.supportsReasoningEffort === false && next.thinkingFormat === undefined) {
      delete next.supportsReasoningEffort;
      changed = true;
    }
    provider.compat = next;
    for (const model of provider.models ?? []) {
      const inferred = inferCustomModelCompat(model.id);
      if (Object.keys(inferred).length === 0) continue;
      const modelCompat = { ...(model.compat ?? {}) };
      if (mergeMissing(modelCompat, inferred)) {
        model.compat = modelCompat;
        changed = true;
      }
    }
  }
  return { file, changed };
}

function stripJsonc(text: string): string {
  return text
    .replace(/^\uFEFF/, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
    .replace(/,\s*([}\]])/g, "$1");
}

export function readModelsFile(path: string): { file: ModelsFile; raw: string; error?: string } {
  if (!existsSync(path)) {
    return { file: { providers: {} }, raw: "{\n  \"providers\": {}\n}\n" };
  }
  const raw = readFileSync(path, "utf8");
  try {
    const file = JSON.parse(stripJsonc(raw)) as ModelsFile;
    return { file, raw };
  } catch (error) {
    return {
      file: { providers: {} },
      raw,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function writeModelsFile(path: string, file: ModelsFile): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`, "utf8");
}
