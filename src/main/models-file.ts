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

function idLooksLike(modelId: string, ...needles: string[]): boolean {
  const id = modelId.toLowerCase();
  return needles.some((needle) => id.includes(needle));
}

/** 按模型 id 推断网关该怎么发思考 / max tokens，只填用户没写过的键。 */
export function inferCustomModelCompat(modelId: string): Record<string, unknown> {
  if (idLooksLike(modelId, "deepseek")) {
    return {
      thinkingFormat: "deepseek",
      supportsReasoningEffort: false,
      maxTokensField: "max_tokens",
      requiresReasoningContentOnAssistantMessages: true,
    };
  }
  if (idLooksLike(modelId, "glm", "chatglm") || modelId.toLowerCase().startsWith("zai")) {
    return {
      thinkingFormat: "zai",
      supportsReasoningEffort: false,
      maxTokensField: "max_tokens",
    };
  }
  if (idLooksLike(modelId, "qwen", "qwq")) {
    return {
      thinkingFormat: "qwen",
      supportsReasoningEffort: false,
      maxTokensField: "max_tokens",
    };
  }
  if (idLooksLike(modelId, "gpt", "o1", "o3", "o4", "luna", "codex")) {
    return {
      maxTokensField: "max_completion_tokens",
    };
  }
  return {};
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

export function applySafeCustomOpenAiCompat(file: ModelsFile): { file: ModelsFile; changed: boolean } {
  const providers = file.providers ?? {};
  let changed = false;
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
