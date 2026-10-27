import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { normalizeModelCosts } from "../src/main/models-file.ts";
import { buildDefaults } from "@shared/models-dev";

/**
 * Regression tests for「启动后提示 No models available、所有模型消失」。
 *
 * 根因：pi 的 cost schema 四个费率全必填，models.dev 常常只给 cache_read。
 * 原样写进 models.json 会让 pi 报 `cost.cacheWrite: must have required properties cacheWrite`
 * 并**丢弃整个文件**，于是自定义 provider 的模型全没了。
 */

const provider = (cost) => ({
  baseUrl: "https://gw.example.com/v1",
  api: "openai-completions",
  apiKey: "k",
  models: [{ id: "m", cost }],
});

/** 用 pi 自己的 ModelRuntime 加载临时 models.json，拿到真正的 schema 校验结果。 */
async function loadWithPi(modelsFile) {
  const dir = mkdtempSync(join(tmpdir(), "pi-cost-"));
  try {
    const modelsPath = join(dir, "models.json");
    const authPath = join(dir, "auth.json");
    writeFileSync(modelsPath, JSON.stringify(modelsFile));
    writeFileSync(authPath, "{}");
    const runtime = await ModelRuntime.create({
      authPath,
      modelsPath,
      modelsStorePath: join(dir, "models-store.json"),
      allowModelNetwork: false,
      refreshOnCreate: false,
    });
    return { error: runtime.getError(), model: runtime.getModel("gw", "m") };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("缺 cacheWrite 的 cost 会让 pi 丢弃整个 models.json（问题复现）", async () => {
  const { error, model } = await loadWithPi({
    providers: { gw: provider({ input: 0.15, output: 0.6, cacheRead: 0.003 }) },
  });
  assert.match(error ?? "", /cacheWrite/);
  assert.equal(model, undefined);
});

test("normalizeModelCosts 补齐四个费率后 pi 能正常加载", async () => {
  const file = {
    providers: { gw: provider({ input: 0.15, output: 0.6, cacheRead: 0.003 }) },
  };
  assert.equal(normalizeModelCosts(file), true);
  assert.deepEqual(file.providers.gw.models[0].cost, {
    input: 0.15,
    output: 0.6,
    cacheRead: 0.003,
    cacheWrite: 0,
  });
  const { error, model } = await loadWithPi(file);
  assert.equal(error, undefined);
  assert.equal(model?.id, "m");
  // 幂等
  assert.equal(normalizeModelCosts(file), false);
});

test("normalizeModelCosts 把非法费率归零", () => {
  const file = {
    providers: {
      gw: provider({ input: "1", output: Number.NaN, cacheRead: -1, cacheWrite: 2 }),
    },
  };
  assert.equal(normalizeModelCosts(file), true);
  assert.deepEqual(file.providers.gw.models[0].cost, {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 2,
  });
});

test("normalizeModelCosts 同时处理 tiers，不碰没有 cost 的模型", () => {
  const file = {
    providers: {
      gw: {
        models: [
          { id: "with-tiers", cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, tiers: [{ inputTokensAbove: 200000, input: 3, output: 4 }] } },
          { id: "no-cost" },
        ],
      },
    },
  };
  assert.equal(normalizeModelCosts(file), true);
  assert.deepEqual(file.providers.gw.models[0].cost.tiers, [
    { inputTokensAbove: 200000, input: 3, output: 4, cacheRead: 0, cacheWrite: 0 },
  ]);
  assert.equal(file.providers.gw.models[1].cost, undefined);
});

test("models.dev 默认值生成的 cost 一开始就是完整四字段", () => {
  const defaults = buildDefaults(
    { id: "deepseek-flash", cost: { input: 0.15, output: 0.6, cacheRead: 0.003 } },
    "models.dev/deepseek",
  );
  assert.deepEqual(defaults.cost, { input: 0.15, output: 0.6, cacheRead: 0.003, cacheWrite: 0 });
  // 至少要能通过 pi 的 schema：交给 normalizeModelCosts 应该无事可做
  const file = { providers: { gw: { models: [{ id: "deepseek-flash", cost: defaults.cost }] } } };
  assert.equal(normalizeModelCosts(file), false);
});
