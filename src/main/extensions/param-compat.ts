import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { MaxTokensField } from "../models-file";

/**
 * Built-in pi extension: 请求体参数兼容层。
 *
 * 部分新式模型（gpt-6-luna、o 系列等）只接受 `max_completion_tokens`，
 * 一旦请求体里出现 `max_tokens` 就直接 400。模型配置里已经声明了期望字段，
 * 但下列来源仍可能把错误字段塞进 payload：
 *   - 旧版本写下的 models.json 残留；
 *   - 模型 `samplingParams` 里手工写了 `max_tokens`；
 *   - 网关/扩展自行追加的参数。
 *
 * 另外 `chat/completions` 下 function tools 与 reasoning_effort 不能共存，
 * 模型 compat 显式声明 `supportsReasoningEffort: false` 时需要把该参数移除。
 *
 * `before_provider_request` 是 pi 提供的请求体最后修改点，在这里统一对齐
 * 参数名/参数存在性，保证配置与真实请求一致（只改名或移除，不改数值）。
 */

export interface ParamCompatHost {
  /** 该模型登记/推断出的 max tokens 字段名；返回 undefined 表示不做改写。 */
  expectedMaxTokensField(modelId: string): MaxTokensField | undefined;
  /** 该模型的 compat 是否显式声明不支持 reasoning_effort。 */
  reasoningEffortDisabled?(modelId: string): boolean;
  /** 发生改写时的通知，便于向用户解释「为什么请求变了」。 */
  onRewrite?(info: { modelId: string; from: string; to: string }): void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function createParamCompatExtension(host: ParamCompatHost): (pi: ExtensionAPI) => void {
  return (pi: ExtensionAPI): void => {
    pi.on("before_provider_request", async (event) => {
      const payload = event.payload;
      if (!isRecord(payload)) return payload;

      const modelId = typeof payload.model === "string" ? payload.model : undefined;
      if (!modelId) return payload;

      // 1) reasoning_effort：配置声明不支持时（completions 下与 tools 冲突）直接移除，
      //    否则网关会返回 400 Function tools with reasoning_effort are not supported。
      if ("reasoning_effort" in payload && host.reasoningEffortDisabled?.(modelId)) {
        delete payload.reasoning_effort;
        host.onRewrite?.({ modelId, from: "reasoning_effort", to: "(已移除)" });
      }

      // 2) max tokens 字段名：按模型登记的字段名纠正。
      const expected = host.expectedMaxTokensField(modelId);
      if (!expected) return payload;

      const unwanted: MaxTokensField = expected === "max_completion_tokens" ? "max_tokens" : "max_completion_tokens";
      if (!(unwanted in payload)) return payload;

      const value = payload[unwanted];
      delete payload[unwanted];
      // 期望字段已存在时保留调用方显式设置的值，只清理多余字段。
      if (!(expected in payload) && value !== undefined) {
        payload[expected] = value;
      }
      host.onRewrite?.({ modelId, from: unwanted, to: expected });
      return payload;
    });
  };
}
