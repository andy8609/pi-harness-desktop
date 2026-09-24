import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { DialogQuestion } from "@shared/types";
import { buildGpaSystemDirective, gpaStageAllowsTools, type GpaState } from "@shared/gpa";
import type { DialogBroker } from "../dialog-broker";

/**
 * Built-in pi extension implementing the GPA workflow boundary.
 *
 * - `before_agent_start` appends the stage directive to the system prompt.
 * - `tool_call` blocks every tool during GOAL/PLAN so those phases stay
 *   analysis-only, except for the clarification tool registered below.
 * - `request_user_input` lets the model ask a small number of structured
 *   questions, rendered as a multi-question dialog by the desktop UI.
 */

interface RawQuestion {
  id?: unknown;
  label?: unknown;
  prompt?: unknown;
  options?: unknown;
  allowFreeText?: unknown;
}

function normalizeOptions(raw: unknown): DialogQuestion["options"] {
  const options: DialogQuestion["options"] = [];
  if (Array.isArray(raw)) {
    for (const [index, item] of raw.entries()) {
      if (options.length >= 4) break;
      if (typeof item === "string") {
        if (item.trim()) options.push({ id: `option_${index + 1}`, label: item.trim() });
        continue;
      }
      if (item && typeof item === "object") {
        const candidate = item as { id?: unknown; label?: unknown };
        const label =
          typeof candidate.label === "string"
            ? candidate.label.trim()
            : typeof candidate.id === "string"
              ? candidate.id.trim()
              : "";
        if (label) {
          options.push({
            id: typeof candidate.id === "string" && candidate.id.trim() ? candidate.id.trim() : `option_${index + 1}`,
            label,
          });
        }
      }
    }
  }
  if (options.length === 0) {
    options.push({ id: "yes", label: "是" }, { id: "no", label: "否" });
  }
  return options;
}

function normalizeQuestions(raw: unknown): DialogQuestion[] {
  if (!Array.isArray(raw)) return [];
  const questions: DialogQuestion[] = [];
  for (const [index, item] of raw.entries()) {
    if (questions.length >= 4) break;
    if (!item || typeof item !== "object") continue;
    const candidate = item as RawQuestion;
    const prompt =
      typeof candidate.prompt === "string" && candidate.prompt.trim()
        ? candidate.prompt.trim()
        : typeof candidate.label === "string"
          ? candidate.label.trim()
          : "";
    if (!prompt) continue;
    questions.push({
      id:
        typeof candidate.id === "string" && candidate.id.trim() ? candidate.id.trim() : `q${index + 1}`,
      label:
        typeof candidate.label === "string" && candidate.label.trim()
          ? candidate.label.trim().slice(0, 48)
          : `问题 ${index + 1}`,
      prompt: prompt.slice(0, 400),
      options: normalizeOptions(candidate.options),
      allowFreeText: false,
    });
  }
  return questions;
}

export function createGpaExtension(
  getState: () => GpaState,
  dialogs: DialogBroker,
): (pi: ExtensionAPI) => void {
  return (pi: ExtensionAPI): void => {
    pi.registerTool({
      name: "request_user_input",
      label: "请求用户澄清",
      description:
        "在 GPA 的目标/计划阶段，当存在无法从上下文确定、且会影响范围/优先级/选型/验收标准的关键问题时，向用户提出 1-3 个结构化问题。每个问题必须提供 2-4 个可选项，用户也可以手动输入其他答案。不要询问工具可以自行确定的事实。",
      promptSnippet: "request_user_input: ask the user 1-3 structured clarifying questions",
      parameters: ({
        type: "object",
        properties: {
          title: { type: "string", description: "澄清卡标题" },
          questions: {
            type: "array",
            description: "1-3 个问题",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                label: { type: "string" },
                prompt: { type: "string" },
                options: { type: "array", items: { type: "string" } },
                allowFreeText: { type: "boolean" },
              },
              required: ["prompt"],
            },
          },
        },
        required: ["questions"],
      }) as never,
      async execute(_toolCallId, params) {
        const raw = (params ?? {}) as { title?: unknown; questions?: unknown };
        const questions = normalizeQuestions(raw.questions);
        if (questions.length === 0) {
          return { content: [{ type: "text", text: "没有可展示的澄清问题。" }], details: {} };
        }
        const title = typeof raw.title === "string" && raw.title.trim() ? raw.title.trim() : "需要确认";
        const value = await dialogs.ask({ kind: "questions", title, questions });
        if (typeof value !== "string") {
          return { content: [{ type: "text", text: "用户取消了澄清。请基于现有信息继续，并明确标注假设。" }], details: {} };
        }
        return { content: [{ type: "text", text: value }], details: {} };
      },
    });

    pi.on("before_agent_start", async (event) => {
      const directive = buildGpaSystemDirective(getState());
      if (!directive) return;
      return { systemPrompt: `${event.systemPrompt}\n\n${directive}` };
    });

    pi.on("tool_call", async (event) => {
      if (gpaStageAllowsTools(getState())) return;
      if (event.toolName === "request_user_input") return;
      return {
        block: true,
        reason:
          "当前处于 GPA 的 GOAL/PLAN 阶段，只做分析与规划，不调用工具。如需澄清请调用 request_user_input，或直接输出目标/计划并请求用户确认。",
      };
    });
  };
}
