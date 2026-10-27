import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildDefaults,
  compactCatalog,
  matchModel,
  matchProvider,
  modelKeyVariants,
  resolveDefaults,
} from "@shared/models-dev";

/** 精简版 models.dev payload，字段形状与线上 api.json 一致。 */
const RAW = {
  anthropic: {
    id: "anthropic",
    name: "Anthropic",
    // 线上 anthropic 没有 provider.api，只能靠域名提示表认出
    models: {
      "claude-sonnet-4": {
        id: "claude-sonnet-4",
        name: "Claude Sonnet 4",
        reasoning: true,
        reasoning_options: [{ type: "toggle" }, { type: "effort", values: ["low", "medium", "high"] }],
        modalities: { input: ["text", "image", "pdf"], output: ["text"] },
        limit: { context: 200000, output: 64000 },
        cost: { input: 3, output: 15, cache_read: 0.3, cache_write: 3.75 },
      },
    },
  },
  openai: {
    id: "openai",
    name: "OpenAI",
    api: "https://api.openai.com/v1",
    models: {
      "gpt-5": {
        id: "gpt-5",
        name: "GPT-5",
        reasoning: true,
        reasoning_options: [{ type: "effort", values: ["minimal", "low", "medium", "high"] }],
        modalities: { input: ["text", "image"], output: ["text"] },
        limit: { context: 400000, output: 128000 },
        cost: { input: 1.25, output: 10 },
      },
    },
  },
  "ollama-cloud": {
    id: "ollama-cloud",
    name: "Ollama Cloud",
    api: "https://ollama.com/v1",
    models: {
      "qwen3-coder": {
        id: "qwen3-coder",
        reasoning: false,
        modalities: { input: ["text"], output: ["text"] },
        limit: { context: 262144, output: 32768 },
      },
    },
  },
  zai: {
    id: "zai",
    name: "Z.AI",
    api: "https://api.z.ai/api/paas/v4",
    models: {
      "glm-4.6": {
        id: "glm-4.6",
        reasoning: true,
        reasoning_options: [{ type: "toggle" }],
        modalities: { input: ["text"], output: ["text"] },
        limit: { context: 200000, output: 128000 },
      },
    },
  },
  gateway: {
    id: "gateway",
    name: "Some Gateway",
    api: "https://gw.example.com/v1",
    models: {
      "hidden-model": {
        id: "hidden-model",
        reasoning: false,
        modalities: { input: ["text"], output: ["text"] },
        limit: { context: 8192, output: 4096 },
      },
      // 同一模型名在手器上也有一份：兜底时应选官方目录
      "gpt-5": {
        id: "gpt-5",
        modalities: { input: ["text"], output: ["text"] },
        limit: { context: 8192, output: 4096 },
      },
    },
  },
};

const catalog = compactCatalog(RAW);

test("compactCatalog 只保留 pi 认识的字段", () => {
  const anthropic = catalog.providers.anthropic;
  assert.ok(anthropic, "应保留 anthropic");
  const model = anthropic.models[0];
  assert.equal(model.id, "claude-sonnet-4");
  // pdf 不在 pi 的 input 枚举里
  assert.deepEqual(model.input, ["text", "image"]);
  assert.equal(model.context, 200000);
  assert.equal(model.maxOutput, 64000);
  assert.deepEqual(model.cost, { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 });
  assert.deepEqual(model.efforts, ["low", "medium", "high"]);
  // 没有 models 的 provider 不占位置
  assert.equal(compactCatalog({ empty: { id: "empty" } }).providers.empty, undefined);
});

test("matchProvider 支持 id、别名、域名和显示名", () => {
  assert.equal(matchProvider(catalog, { providerId: "openai", modelIds: [] })?.id, "openai");
  // 别名：本地 ollama 预设指向 models.dev 的 ollama-cloud
  assert.equal(matchProvider(catalog, { providerId: "ollama", modelIds: [] })?.id, "ollama-cloud");
  assert.equal(matchProvider(catalog, { providerId: "zhipu", modelIds: [] })?.id, "zai");
  // 自定义 id 靠 baseUrl 域名反查（anthropic 目录没有 provider.api，只能靠域名提示表）
  assert.equal(
    matchProvider(catalog, { providerId: "my-claude", baseUrl: "https://api.anthropic.com/v1", modelIds: [] })?.id,
    "anthropic",
  );
  // 靠 provider.api 声明的 baseURL 反查
  assert.equal(
    matchProvider(catalog, { providerId: "my-gw", baseUrl: "https://gw.example.com/v1", modelIds: [] })?.id,
    "gateway",
  );
  // 再靠显示名
  assert.equal(matchProvider(catalog, { providerId: "x", name: "OpenAI", modelIds: [] })?.id, "openai");
  assert.equal(matchProvider(catalog, { providerId: "unknown-provider", modelIds: [] }), undefined);
});

test("matchModel 兼容网关前缀与后缀", () => {
  const openai = catalog.providers.openai;
  assert.equal(matchModel(openai, "gpt-5")?.id, "gpt-5");
  assert.equal(matchModel(openai, "GPT-5")?.id, "gpt-5");
  assert.equal(matchModel(openai, "openai/gpt-5")?.id, "gpt-5");
  assert.equal(matchModel(openai, "gpt-5:free")?.id, "gpt-5");
  assert.equal(matchModel(openai, "gpt-5@2025-08-07")?.id, "gpt-5");
  assert.equal(matchModel(openai, "not-a-model"), undefined);
});

test("modelKeyVariants 去前缀/后缀且不多给", () => {
  assert.deepEqual(modelKeyVariants("openai/gpt-5:free"), ["openai/gpt-5:free", "gpt-5:free", "openai/gpt-5", "gpt-5"]);
  assert.deepEqual(modelKeyVariants("  "), []);
});

test("buildDefaults 把 reasoning_options 映射成 pi 思考档位", () => {
  const effort = buildDefaults(catalog.providers.openai.models[0], "models.dev/openai");
  assert.equal(effort.contextWindow, 400000);
  assert.equal(effort.maxTokens, 128000);
  assert.equal(effort.reasoning, true);
  assert.deepEqual(effort.thinkingLevels, ["off", "minimal", "low", "medium", "high"]);
  assert.equal(effort.defaultThinkingLevel, "medium");

  const toggle = buildDefaults(catalog.providers.zai.models[0], "models.dev/zai");
  assert.deepEqual(toggle.thinkingLevels, ["off", "high"]);
  assert.equal(toggle.defaultThinkingLevel, "high");

  const plain = buildDefaults(catalog.providers["ollama-cloud"].models[0], "models.dev/ollama-cloud");
  assert.equal(plain.reasoning, undefined);
  assert.equal(plain.thinkingLevels, undefined);
  assert.equal(plain.defaultThinkingLevel, undefined);
  assert.deepEqual(plain.input, ["text"]);
});

test("resolveDefaults 批量命中 provider 内的模型", () => {
  const result = resolveDefaults(catalog, {
    providerId: "openai",
    modelIds: ["gpt-5", "openai/gpt-5:free", "missing-model"],
  });
  assert.equal(result["gpt-5"].source, "models.dev/openai");
  assert.equal(result["gpt-5"].contextWindow, 400000);
  assert.equal(result["openai/gpt-5:free"].id, "gpt-5");
  assert.equal(result["missing-model"], undefined);
});

test("resolveDefaults 未命中 provider 时只信厂商官方目录", () => {
  const result = resolveDefaults(catalog, {
    providerId: "unknown-provider",
    modelIds: ["glm-4.6", "hidden-model", "qwen3-coder"],
  });
  // 厂商官方目录能找到 → 补
  assert.equal(result["glm-4.6"].source, "models.dev/zai");
  // 只存在于第三方/平台网关 → 不补（价格和上下文不可信）
  assert.equal(result["hidden-model"], undefined);
  assert.equal(result["qwen3-coder"], undefined);
});

test("resolveDefaults 对空输入直接返回空表", () => {
  assert.deepEqual(resolveDefaults(catalog, { providerId: "openai", modelIds: [] }), {});
});

test("resolveDefaults 对本地服务器不套云端元数据", () => {
  assert.deepEqual(
    resolveDefaults(catalog, {
      providerId: "ollama",
      baseUrl: "http://localhost:11434/v1",
      modelIds: ["qwen3-coder", "glm-4.6"],
    }),
    {},
  );
  assert.deepEqual(
    resolveDefaults(catalog, {
      providerId: "lmstudio",
      baseUrl: "http://127.0.0.1:1234/v1",
      modelIds: ["gpt-5"],
    }),
    {},
  );
});

test("resolveDefaults 多网关同名模型时优先官方目录", () => {
  const result = resolveDefaults(catalog, {
    providerId: "some-proxy",
    baseUrl: "https://proxy.example.com/v1",
    modelIds: ["gpt-5"],
  });
  assert.equal(result["gpt-5"].source, "models.dev/openai");
  // 官方目录里 gpt-5 有 400K 上下文，而不是手器上的 8K
  assert.equal(result["gpt-5"].contextWindow, 400000);
});
