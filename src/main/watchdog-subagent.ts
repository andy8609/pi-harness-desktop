import {
  DefaultResourceLoader,
  SessionManager,
  createAgentSession,
  getAgentDir,
  type ModelRuntime,
} from "@earendil-works/pi-coding-agent";

/**
 * 巡查触发阈值：**单个操作**（一次工具调用或一次模型回复）持续超过该时长才巡查。
 * 不再按「本轮总时长」定时巡查 —— 正常的长任务由多个短操作组成，不应因此被判定为卡住。
 */
export const WATCHDOG_OPERATION_TIMEOUT_MS = 2 * 60 * 1000;
/** 巡查子代理自身的执行超时。 */
export const WATCHDOG_TIMEOUT_MS = 2 * 60 * 1000;

export interface WatchdogBrief {
  cwd: string;
  /** 当前操作已持续的毫秒数（巡查依据）。 */
  operationElapsedMs: number;
  /** 当前操作的描述，例如「执行 bash」「模型回复」。 */
  operation: string;
  /** 本轮总计耗时，仅作为上下文背景。 */
  turnElapsedMs: number;
  round: number;
  activity?: string;
  lastUser?: string;
  gpa?: string;
  recentTools?: string[];
}

export function buildWatchdogPrompt(brief: WatchdogBrief): string {
  const opMinutes = Math.max(1, Math.round(brief.operationElapsedMs / 60000));
  const turnMinutes = Math.max(1, Math.round(brief.turnElapsedMs / 60000));
  const tools = brief.recentTools?.length ? brief.recentTools.join(" → ") : "暂无工具记录";
  const goal = brief.lastUser?.trim() ? brief.lastUser.trim().slice(0, 800) : "未知";
  const activity = brief.activity?.trim() || "未知";
  const gpa = brief.gpa?.trim() || "未启用 GPA";
  return [
    "你是进度巡查子代理。主代理的**某一个操作**已持续超过时限仍未结束，可能是卡住或正在执行重活。",
    "请只读检查工作区，用中文给出简短进展报告（不超过 12 行）：",
    "1. 这个操作最可能卡在哪里",
    "2. 已有哪些可见进展（文件、计划、输出）",
    "3. 看起来是正常执行（重任务）、卡住，还是失败",
    "4. 如果是卡住，给出可执行的脱困建议",
    "不要修改任何文件，不要运行会改变状态的命令。",
    "",
    `项目目录：${brief.cwd}`,
    `当前操作：${brief.operation}（已持续约 ${opMinutes} 分钟）`,
    `本轮总计：约 ${turnMinutes} 分钟（第 ${brief.round} 次巡查）`,
    `主代理当前活动：${activity}`,
    `GPA：${gpa}`,
    `最近工具：${tools}`,
    `用户目标：${goal}`,
  ].join("\n");
}

export async function runWatchdogSubagent(input: {
  cwd: string;
  modelRuntime: ModelRuntime;
  provider: string;
  modelId: string;
  brief: WatchdogBrief;
  signal: AbortSignal;
}): Promise<string> {
  const model = input.modelRuntime.getModel(input.provider, input.modelId);
  if (!model) throw new Error(`子代理找不到模型 ${input.provider}/${input.modelId}`);

  const agentDir = getAgentDir();
  const resourceLoader = new DefaultResourceLoader({
    cwd: input.cwd,
    agentDir,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
  });
  await resourceLoader.reload();

  const { session } = await createAgentSession({
    cwd: input.cwd,
    agentDir,
    modelRuntime: input.modelRuntime,
    model,
    thinkingLevel: "off",
    tools: ["read", "grep", "find", "ls"],
    excludeTools: ["bash", "edit", "write", "powershell"],
    resourceLoader,
    sessionManager: SessionManager.inMemory(input.cwd),
  });

  if (input.signal.aborted) {
    await session.abort().catch(() => undefined);
    throw new Error("巡查已取消");
  }

  let text = "";
  const unsubscribe = session.subscribe((event) => {
    if (event.type !== "message_update") return;
    const assistantEvent = (event as { assistantMessageEvent?: { type?: string; delta?: string } }).assistantMessageEvent;
    if (assistantEvent?.type === "text_delta" && assistantEvent.delta) text += assistantEvent.delta;
  });

  const abort = () => {
    void session.abort().catch(() => undefined);
  };
  input.signal.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, WATCHDOG_TIMEOUT_MS);
  try {
    await session.prompt(buildWatchdogPrompt(input.brief));
  } finally {
    clearTimeout(timer);
    input.signal.removeEventListener("abort", abort);
    unsubscribe();
    await session.abort().catch(() => undefined);
  }

  const summary = text.trim();
  if (!summary) throw new Error("子代理没有返回文本");
  return summary;
}
