/**
 * GPA (Goal / Plan / Act) workflow — pure state machine and parsers.
 *
 * Ported from workagent's `packages/agent-runtime/src/gpa.ts`. The runtime
 * specifics (tool enforcement, system-prompt injection) live in the built-in
 * pi extension; everything here is deterministic and side-effect free so it can
 * be shared by the main process and the renderer.
 */

export type GpaStage = "off" | "goal" | "plan" | "act";

export interface PlanTask {
  id: string;
  title: string;
  done: boolean;
}

export interface GpaState {
  stage: GpaStage;
  planTasks: PlanTask[];
  /** Set when a stage is waiting for the user's confirmation. */
  awaitingConfirmation: "goal" | "plan" | null;
  updatedAt: string;
}

export const DEFAULT_GPA_STATE: GpaState = {
  stage: "off",
  planTasks: [],
  awaitingConfirmation: null,
  updatedAt: new Date(0).toISOString(),
};

export function createDefaultGpaState(): GpaState {
  return { ...DEFAULT_GPA_STATE, planTasks: [], updatedAt: new Date().toISOString() };
}

const STAGE_LABELS: Record<GpaStage, string> = {
  off: "关闭",
  goal: "目标 GOAL",
  plan: "计划 PLAN",
  act: "执行 ACT",
};

export function gpaStageLabel(stage: GpaStage): string {
  return STAGE_LABELS[stage];
}

/** GOAL / PLAN are analysis-only phases; tools are disabled there. */
export function gpaStageAllowsTools(state: GpaState): boolean {
  return state.stage === "off" || state.stage === "act";
}

export function canEnterGpaAct(state: GpaState): boolean {
  return state.stage === "plan" && state.planTasks.length > 0;
}

export function nextStageAfterConfirmation(stage: GpaStage): GpaStage {
  if (stage === "goal") return "plan";
  if (stage === "plan") return "act";
  return stage;
}

export function detectGpaConfirmation(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return /^(确认|好的|好耶|ok|okay|开始|继续|yes|go|可以|批准|同意|done|继续吧|没问题|收到|行)/i.test(trimmed);
}

export function buildGpaSystemDirective(state: GpaState): string {
  if (state.stage === "off") return "";
  const header = `你正在运行 GPA（Goal-Plan-Act）工作流，当前阶段为【${gpaStageLabel(
    state.stage,
  )}】。遵守核心铁律：阶段不可跳、执行不可超、异常不可瞒、用户不可绕。`;
  const rules: Record<Exclude<GpaStage, "off">, string> = {
    goal: [
      "【GOAL 目标解析】只做分析：不写代码、不创建/修改文件、不调用任何工具、不假设未明确的信息。",
      "1) 用一句话清晰重述用户真实目标，消除歧义；",
      "2) 列出 3-5 条可量化的成功标准（必须能用「是/否」验证）；",
      "3) 识别约束：技术栈、时间/资源、输出格式、明确排除的范围；",
      "4) 若信息不足，调用 request_user_input 提出最多 3 个澄清问题；每个问题必须给出 2-4 个可选项，用户也可手动输入其他答案；",
      "5) 结尾必须输出：⏳ 请确认目标，或补充信息后进入计划阶段。",
    ].join("\n"),
    plan: [
      "【PLAN 计划拆解】只做规划：不实际执行任何代码或文件操作，不调用工具。",
      "1) 将目标拆分为原子任务（单一职责、可独立完成、有明确交付物）；",
      "2) 每个任务必须使用 `### T1: 任务标题` 的格式，从 T1 连续编号，不得跳号或重复；",
      "3) 每个任务包含：动作、交付物、依赖、验收标准；",
      "4) 标注关键路径、可并行任务与风险预案；",
      "5) 结尾必须输出：⏳ 请确认计划，或提出修改意见。",
    ].join("\n"),
    act: [
      "【ACT 执行与反馈】按已确认的计划范围执行，不擅自扩展。运行时会在任务之间自动续跑，不要因为「更新了计划」就停下来等用户输入继续。",
      "1) 准备：检查前置任务是否完成，确认工具/环境/数据就绪，条件不满足立即停止并上报；",
      "2) 执行：每次只执行当前最早未完成的一个任务；编写代码遵循单一职责、清晰命名、必要注释；",
      "3) 自检：对照验收标准逐项检查，不达标不得标记完成；",
      "4) 记录：完成后必须输出 `✅ 任务 {ID} 完成`、交付物摘要、遇到的问题与解决方案、对后续任务的影响；",
      "5) 续跑：一项通过验收后，立刻开始下一项未完成任务。不要等待用户输入「继续」「开始」或确认；也不要只更新计划列表就结束本轮；",
      "6) 停止并上报：仅在需求变更/范围蔓延、技术方案不可行/阻塞、自检未通过且无法自行修复、或必须由用户做选型/优先级决策时停止。此时调用 request_user_input，不要用纯文本提问后空等；",
      "7) 不得跳过中间任务，也不得提前标记收尾或验收任务完成。不要让文件操作或进度文案替代 `✅ 任务 {ID} 完成`；",
      "8) 全部 PLAN 任务标记完成后不得再调用工具或追加验证，只生成最终总结。",
    ].join("\n"),
  };
  const analysisClarificationRule =
    state.stage === "goal" || state.stage === "plan"
      ? "\nFor GPA analysis, the only permitted tool is request_user_input. If technology, scope, priority, irreversible impact, or acceptance criteria cannot be safely resolved from the available context, call request_user_input once with one to three short questions and options. Do not put questions in assistant_message. After its tool result, incorporate every answer and continue the same analysis stage."
      : "";
  const actClarificationRule =
    state.stage === "act"
      ? "\nBefore any write, command, or external side effect, if a material decision cannot be verified with the available context or tools, call request_user_input with one to three concise questions and options. Never ask for facts that tools can determine. After its tool result, continue immediately; revise the plan only when the answers materially change it."
      : "";
  const planTaskIdContract =
    state.stage === "plan"
      ? "\n[PLAN task ID contract]\nEvery atomic task heading must use exactly `### T1: Task title`. Continue with T2, T3, and so on without gaps or duplicates. Start at T1. Do not create new numbered task lists in critical-path, risk, summary, or deliverable sections; reference the existing T-IDs inline instead."
      : "";
  const pending = state.planTasks.filter((task) => !task.done);
  const resumeContract =
    state.stage === "act" && pending.length > 0
      ? `\nExisting confirmed PLAN is already in progress. Do not restart GOAL/PLAN analysis. Focus on incomplete tasks:\n${pending
          .map((task) => `- ${task.id}: ${task.title}`)
          .join("\n")}\nAfter finishing work, output \`✅ 任务 {ID} 完成\` and continue the next unfinished task in the same turn.`
      : "";
  return `${header}\n\n${rules[state.stage]}${analysisClarificationRule}${actClarificationRule}${planTaskIdContract}${resumeContract}`;
}

/** Strict parser for the canonical `### T1: title` plan format. */
export function parseCanonicalGpaPlanTasks(content: string): PlanTask[] {
  const tasks: PlanTask[] = [];
  const seenIds = new Set<string>();
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^\s*###\s+(T\d+)\s*:\s*(.+?)\s*$/i);
    if (!match) continue;
    const id = match[1].toUpperCase();
    const title = match[2].replace(/\*\*/g, "").replace(/`/g, "").trim();
    if (!title || seenIds.has(id)) return [];
    seenIds.add(id);
    tasks.push({ id, title: title.slice(0, 180), done: false });
  }
  return tasks.length > 0 && tasks.every((task, index) => task.id === `T${index + 1}`) ? tasks : [];
}

/** Lenient parser covering headings, list items, numbered and Chinese plans. */
export function parseGpaPlanTasks(content: string): PlanTask[] {
  const tasks: PlanTask[] = [];
  const seenIds = new Set<string>();
  const lines = content.split(/\r?\n/);
  const append = (idValue: string, titleValue: string) => {
    const id = idValue.toUpperCase();
    const title = titleValue.replace(/\*\*/g, "").replace(/`/g, "").trim();
    if (!title || seenIds.has(id)) return;
    seenIds.add(id);
    tasks.push({ id, title: title.slice(0, 180), done: false });
  };

  for (const line of lines) {
    const match = line.match(/^\s*#{1,6}\s*(T\d+)(?:\s*[:\uFF1A-]\s*|\s+)(.+?)\s*$/i);
    if (!match) continue;
    append(match[1], match[2]);
    if (tasks.length >= 20) break;
  }
  for (const line of lines) {
    const match = line.match(/^\s*(?:#{1,6}\s*)?(?:[-*+]\s*)?(T\d+)\s*[:\uFF1A.\-]\s*(.+?)\s*$/i);
    if (!match) continue;
    append(match[1], match[2]);
    if (tasks.length >= 20) break;
  }
  if (tasks.length === 0) {
    for (const line of lines) {
      const match = line.match(/^\s*(?:[-*+]\s*)?(\d+)\s*[.)\u3001]\s*(.+?)\s*$/);
      if (!match) continue;
      append(`T${match[1]}`, match[2]);
      if (tasks.length >= 20) break;
    }
  }
  if (tasks.length === 0) {
    for (const line of lines) {
      const match = line.match(
        /^\s*(?:#{1,6}\s*)?(?:[-*+]\s*)?(?:任务|步骤|计划)\s*(\d+)\s*[:\uFF1A.\-\u3001]\s*(.+?)\s*$/i,
      );
      if (!match) continue;
      append(`T${match[1]}`, match[2]);
      if (tasks.length >= 20) break;
    }
  }
  return tasks;
}

/** Keep completed state when a later PLAN output contains more tasks. */
export function reconcileGpaPlanTasks(current: PlanTask[], planBody: string): PlanTask[] {
  const parsed = parseGpaPlanTasks(planBody);
  if (parsed.length <= current.length) return current;
  const completed = new Set(current.filter((task) => task.done).map((task) => `${task.id}\u0000${task.title}`));
  return parsed.map((task) => ({ ...task, done: completed.has(`${task.id}\u0000${task.title}`) }));
}

export function normalizeSequentialPlanTasks(tasks: PlanTask[]): PlanTask[] {
  let encounteredPending = false;
  let changed = false;
  const normalized = tasks.map((task) => {
    if (!task.done) {
      encounteredPending = true;
      return task;
    }
    if (!encounteredPending) return task;
    changed = true;
    return { ...task, done: false };
  });
  return changed ? normalized : tasks;
}

export interface GpaCompletedTaskDeclaration {
  taskIds: string[];
  text: string;
}

/**
 * Find explicit ACT progress statements such as `✅ 任务 T1 完成` or `T1 completed`.
 * Future-tense prose ("开始实现 T1") is intentionally ignored.
 */
export function parseGpaCompletedTaskDeclarations(
  content: string,
  planTasks: PlanTask[],
): GpaCompletedTaskDeclaration[] {
  if (!content.trim() || planTasks.length === 0) return [];
  const knownTaskIds = new Set(planTasks.map((task) => task.id.toUpperCase()));
  const completion =
    /(?:\b(?:complete(?:d)?|finished|done|implemented|verified)\b|✅|☑|\[x\]|(?:已\s*)?完成|(?:已\s*(?:实现|验证|处理)))/i;
  const negated =
    /(?:(?:尚)?未|未能|not|incomplete|pending|todo|remaining|剩余)\s*(?:完成|实现|验证|处理|任务|complete(?:d)?|finished|done|implemented|verified)?/i;
  const future = /(?:开始|准备|即将|接下来|覆盖|\b(?:starting|going to|about to|will|covering|implementing|verifying)\b)/i;
  const declarations: GpaCompletedTaskDeclaration[] = [];

  for (const rawSegment of content.split(/[\r\n。！!?;；，,]+/)) {
    const text = rawSegment.trim();
    if (!text || !completion.test(text) || negated.test(text) || future.test(text)) continue;
    const taskIds = [...text.matchAll(/\bT\s*(\d+)\b|任务\s*(\d+)/gi)]
      .map((match) => `T${match[1] ?? match[2]}`.toUpperCase())
      .filter((id, index, values) => knownTaskIds.has(id) && values.indexOf(id) === index);
    if (taskIds.length > 0) declarations.push({ taskIds, text });
  }
  return declarations;
}

/** Checkbox-style ACT progress such as `- [x] **T1** title`. */
export function parseGpaCheckboxCompletions(content: string, planTasks: PlanTask[]): string[] {
  if (!content.trim() || planTasks.length === 0) return [];
  const knownTaskIds = new Set(planTasks.map((task) => task.id.toUpperCase()));
  const taskIds: string[] = [];
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^\s*[-*+]\s*\[x\]\s*(?:\*\*)?(T\d+)(?:\*\*)?/i);
    if (!match) continue;
    const id = match[1].toUpperCase();
    if (knownTaskIds.has(id) && !taskIds.includes(id)) taskIds.push(id);
  }
  return taskIds;
}

export function isInternalGpaPrompt(text: string): boolean {
  return /^\s*\[internal:gpa-(?:confirm|continue|resume)\]/i.test(text);
}

export function displayGpaPrompt(text: string): string | undefined {
  const trimmed = text.trim();
  if (/^\s*\[internal:gpa-confirm\]/i.test(trimmed)) {
    return /Enter ACT|implement the planned|开始执行/i.test(trimmed)
      ? "已确认计划，开始执行"
      : "已确认目标，开始制定计划";
  }
  if (/^\s*\[internal:gpa-(?:continue|resume)\]/i.test(trimmed)) {
    const leftover = trimmed.match(/还剩\s*(\d+)\s*项/)?.[1];
    return leftover ? `继续执行剩余的 GPA 计划任务（还剩 ${leftover} 项）` : "继续执行剩余的 GPA 计划任务";
  }
  return undefined;
}

export function buildGpaContinuePrompt(input: {
  nextTask: PlanTask;
  doneCount: number;
  totalCount: number;
}): string {
  return [
    "[internal:gpa-continue] Continue the remaining incomplete GPA plan tasks. Do not restart GOAL/PLAN analysis.",
    `Execute the next unfinished task ${input.nextTask.id} (${input.nextTask.title}).`,
    `After it meets acceptance criteria, output \`✅ 任务 ${input.nextTask.id} 完成\` and immediately continue the following unfinished task.`,
    `Do not wait for the user to type 继续. Current progress ${input.doneCount}/${input.totalCount}.`,
  ].join(" ");
}

export function buildGpaResumePrompt(pendingCount: number): string {
  return [
    "[internal:gpa-resume] Continue the remaining incomplete GPA plan tasks from .codexh/gpa-plan.md.",
    "Do not restart GOAL/PLAN analysis. Execute the next unfinished task and keep marking completed tasks with `✅ 任务 {ID} 完成`.",
    `还剩 ${pendingCount} 项。`,
  ].join(" ");
}

/** Advance only the earliest unfinished task, never skipping prerequisites. */
export function applyCompletedPlanTasks(state: GpaState, completedTaskIds: string[]): GpaState {
  if (!completedTaskIds.length || !state.planTasks.length) return state;
  const completed = new Set(completedTaskIds.map((id) => id.trim().toUpperCase()).filter(Boolean));
  const currentTask = state.planTasks.find((task) => !task.done);
  if (!currentTask || !completed.has(currentTask.id.toUpperCase())) return state;
  let changed = false;
  const planTasks = state.planTasks.map((task) => {
    if (task.id !== currentTask.id || task.done) return task;
    changed = true;
    return { ...task, done: true };
  });
  return changed ? { ...state, planTasks } : state;
}
