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
 * Unknown OpenAI-compat MaaS (IPSA/Thor 等) 会把 SDK 默认的 OpenAI 字段当成非法请求打回 400。
 * 只补用户没写过的键，不覆盖已有 compat。
 */
export const SAFE_CUSTOM_OPENAI_COMPAT: Record<string, unknown> = {
  supportsStore: false,
  supportsDeveloperRole: false,
  supportsReasoningEffort: false,
  supportsUsageInStreaming: false,
  maxTokensField: "max_tokens",
};

export function applySafeCustomOpenAiCompat(file: ModelsFile): { file: ModelsFile; changed: boolean } {
  const providers = file.providers ?? {};
  let changed = false;
  for (const provider of Object.values(providers)) {
    if (!usesOpenAiCompletions(provider)) continue;
    if (isOfficialOpenAICompatHost(provider.baseUrl)) continue;
    const next = { ...(provider.compat ?? {}) };
    for (const [key, value] of Object.entries(SAFE_CUSTOM_OPENAI_COMPAT)) {
      if (next[key] === undefined) {
        next[key] = value;
        changed = true;
      }
    }
    provider.compat = next;
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
