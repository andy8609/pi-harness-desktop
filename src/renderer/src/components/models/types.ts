import type { CustomModelConfig, CustomProviderConfig, ModelsFile } from "@shared/types";

/**
 * UI-facing view of a pi `models.json` provider/model, plus the mapping back.
 *
 * PI-Desktop's model studio works on `ProviderPublic` / `ModelBinding`. pi has
 * a smaller schema, so a few studio fields (provider name, enabled, per-model
 * thinking levels) are stored as extension keys that pi ignores.
 */

export interface UiModelBinding {
  id: string;
  alias?: string;
  contextWindow?: number;
  maxTokens?: number;
  reasoning?: boolean;
  input?: string[];
  thinkingLevels: string[];
  defaultThinkingLevel: string | null;
}

export interface UiProvider {
  id: string;
  name: string;
  baseUrl: string;
  api: string;
  apiKey?: string;
  headers?: Record<string, string>;
  enabled: boolean;
  models: UiModelBinding[];
}

export const API_STYLES = [
  { id: "openai-completions", label: "OpenAI Chat Completions" },
  { id: "openai-responses", label: "OpenAI Responses" },
  { id: "anthropic-messages", label: "Anthropic Messages" },
  { id: "google-generative-ai", label: "Google Generative AI" },
] as const;

export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

export const CONTEXT_WINDOW_PRESETS = [
  { label: "32K", tokens: 32000 },
  { label: "128K", tokens: 128000 },
  { label: "200K", tokens: 200000 },
  { label: "256K", tokens: 256000 },
  { label: "1M", tokens: 1000000 },
];

export const MAX_OUTPUT_PRESETS = [
  { label: "4K", tokens: 4096 },
  { label: "8K", tokens: 8192 },
  { label: "16K", tokens: 16384 },
  { label: "32K", tokens: 32000 },
  { label: "64K", tokens: 64000 },
];

export interface ServicePreset {
  id: string;
  label: string;
  name: string;
  baseUrl: string;
  api: string;
  apiKey?: string;
}

export const CUSTOM_SERVICE = "custom";

/** Named endpoints offered by the service picker. */
export const SERVICE_PRESETS: ServicePreset[] = [
  { id: "openai", label: "OpenAI", name: "OpenAI", baseUrl: "https://api.openai.com/v1", api: "openai-completions" },
  { id: "anthropic", label: "Anthropic", name: "Anthropic", baseUrl: "https://api.anthropic.com/v1", api: "anthropic-messages" },
  {
    id: "google",
    label: "Google Gemini",
    name: "Google Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    api: "google-generative-ai",
  },
  { id: "deepseek", label: "DeepSeek", name: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", api: "openai-completions" },
  { id: "openrouter", label: "OpenRouter", name: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", api: "openai-completions" },
  { id: "ollama", label: "Ollama（本地）", name: "Ollama", baseUrl: "http://localhost:11434/v1", api: "openai-completions", apiKey: "ollama" },
  { id: "lmstudio", label: "LM Studio（本地）", name: "LM Studio", baseUrl: "http://localhost:1234/v1", api: "openai-completions", apiKey: "lmstudio" },
  { id: "vllm", label: "vLLM（本地）", name: "vLLM", baseUrl: "http://localhost:8000/v1", api: "openai-completions", apiKey: "vllm" },
];

export function serviceForProvider(provider: UiProvider): string {
  const match = SERVICE_PRESETS.find((preset) => preset.baseUrl === provider.baseUrl);
  return match?.id ?? CUSTOM_SERVICE;
}

export function providerFromConfig(id: string, config: CustomProviderConfig): UiProvider {
  return {
    id,
    name: config.name ?? id,
    baseUrl: config.baseUrl ?? "",
    api: config.api ?? "openai-completions",
    apiKey: config.apiKey,
    headers: config.headers,
    enabled: config.enabled !== false,
    models: (config.models ?? []).map((model) => ({
      id: model.id,
      alias: model.name,
      contextWindow: model.contextWindow,
      maxTokens: model.maxTokens,
      reasoning: model.reasoning,
      input: model.input,
      thinkingLevels: model.thinkingLevels ?? (model.reasoning ? [...THINKING_LEVELS] : []),
      defaultThinkingLevel: model.defaultThinkingLevel ?? null,
    })),
  };
}

export function configFromProvider(provider: UiProvider): CustomProviderConfig {
  const models: CustomModelConfig[] = provider.models.map((model) => ({
    id: model.id,
    ...(model.alias?.trim() ? { name: model.alias.trim() } : {}),
    ...(model.reasoning !== undefined ? { reasoning: model.reasoning } : {}),
    ...(model.input && model.input.length > 0 ? { input: model.input } : {}),
    ...(model.contextWindow ? { contextWindow: model.contextWindow } : {}),
    ...(model.maxTokens ? { maxTokens: model.maxTokens } : {}),
    ...(model.thinkingLevels.length > 0 ? { thinkingLevels: model.thinkingLevels } : {}),
    ...(model.defaultThinkingLevel ? { defaultThinkingLevel: model.defaultThinkingLevel } : {}),
  }));
  return {
    ...(provider.name.trim() ? { name: provider.name.trim() } : {}),
    baseUrl: provider.baseUrl.trim(),
    api: provider.api,
    ...(provider.apiKey?.trim() ? { apiKey: provider.apiKey.trim() } : {}),
    ...(provider.headers && Object.keys(provider.headers).length > 0 ? { headers: provider.headers } : {}),
    enabled: provider.enabled,
    models,
  };
}

export function listProviders(file: ModelsFile): UiProvider[] {
  return Object.entries(file.providers ?? {}).map(([id, config]) => providerFromConfig(id, config));
}

export function formatTokenCount(value?: number): string {
  if (!value) return "—";
  if (value >= 1_000_000) return `${Math.round(value / 100_000) / 10}M`;
  if (value >= 1000) return `${Math.round(value / 1000)}K`;
  return String(value);
}

export function matchPresetIndex(presets: Array<{ tokens: number }>, value?: number): number {
  if (!value) return -1;
  return presets.findIndex((preset) => preset.tokens === value);
}
