import { copyFileSync, existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { shell } from "electron";
import {
  DEFAULT_REASONING_LEVELS,
  THINKING_LEVELS,
  orderedThinkingLevels,
  type CatalogPackage,
  type DesktopSettings,
  type DialogRequest,
  type InstalledResource,
  type ModelOption,
  type ModelsFile,
  type PackageInventory,
  type PromptImage,
  type PromptPayload,
  type ProviderOption,
  type QueueMutation,
  type CreateResourceFileInput,
  type ResourceFile,
  type ResourceFiles,
  type ResourceSummary,
  type SessionListItem,
  type SessionSnapshot,
  type SlashCommand,
  type StreamEvent,
  type ThinkingLevel,
  type TreeNode,
  type WatchdogReport,
} from "@shared/types";
import {
  applyCompletedPlanTasks,
  buildGpaContinuePrompt,
  buildGpaResumePrompt,
  createDefaultGpaState,
  detectGpaConfirmation,
  normalizeSequentialPlanTasks,
  parseCanonicalGpaPlanTasks,
  parseGpaCheckboxCompletions,
  parseGpaCompletedTaskDeclarations,
  parseGpaPlanTasks,
  liveReconcileGpaPlanTasks,
  type GpaState,
} from "@shared/gpa";
import {
  gpaPlanHasIncompleteTasks,
  toGpaPlanResumePreview,
  type GpaPlanFileStatus,
  type GpaPlanResumePreview,
} from "@shared/gpa-plan-file";
import { readGpaPlanFile, writeGpaPlanFile } from "./gpa-plan-io";
import {
  createResourceFileOnDisk,
  emptyResourceFiles,
  resourceFileName,
  samePath,
  toResourceFile,
  writeAgentsContextFile,
  writePromptTemplateFile,
} from "./resource-files";
import { WATCHDOG_INTERVAL_MS, runWatchdogSubagent } from "./watchdog-subagent";
import {
  type CreateAgentSessionRuntimeFactory,
  type CreateAgentSessionRuntimeResult,
  type LoadExtensionsResult,
  ModelRuntime,
  ProjectTrustStore,
  SessionManager,
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
  getAgentDir,
  hasTrustRequiringProjectResources,
} from "@earendil-works/pi-coding-agent";
import type { AgentSessionRuntime } from "@earendil-works/pi-coding-agent";

type AuthType = "api_key" | "oauth";
type AuthPrompt = {
  type: "text" | "secret" | "select" | "manual_code";
  message: string;
  placeholder?: string;
  options?: Array<{ id: string; label: string; description?: string }>;
};
type AuthEvent =
  | { type: "info"; message: string }
  | { type: "auth_url"; url: string; instructions?: string }
  | { type: "device_code"; userCode: string; verificationUri: string };

function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((part) => (part as { type?: string }).type === "text")
      .map((part) => String((part as { text?: unknown }).text ?? ""))
      .join("");
  }
  return "";
}

/** 合法思考等级集合，用于校验 models.json 中配置的每模型默认思考等级。 */
const VALID_THINKING_LEVELS = new Set<ThinkingLevel>(THINKING_LEVELS);

const BUILTIN_SLASH_COMMANDS: SlashCommand[] = [
  { name: "settings", description: "打开设置", source: "builtin" },
  { name: "model", description: "选择模型", source: "builtin" },
  { name: "thinking", description: "设置思考等级", source: "builtin" },
  { name: "export", description: "导出会话", source: "builtin" },
  { name: "import", description: "导入 JSONL 会话", source: "builtin" },
  { name: "name", description: "设置会话名称", source: "builtin" },
  { name: "session", description: "查看会话信息", source: "builtin" },
  { name: "fork", description: "从历史用户消息分叉", source: "builtin" },
  { name: "clone", description: "复制当前分支", source: "builtin" },
  { name: "tree", description: "打开会话树", source: "builtin" },
  { name: "trust", description: "保存项目信任决定", source: "builtin" },
  { name: "login", description: "登录提供商", source: "builtin" },
  { name: "logout", description: "登出提供商", source: "builtin" },
  { name: "new", description: "新建会话", source: "builtin" },
  { name: "compact", description: "压缩上下文", source: "builtin" },
  { name: "resume", description: "恢复其他会话", source: "builtin" },
  { name: "reload", description: "重新加载扩展、Skills 与上下文", source: "builtin" },
  { name: "quit", description: "退出", source: "builtin" },
];
import { catalogUpdatedAt, fetchPiPackages } from "./catalog";
import type { DialogBroker } from "./dialog-broker";
import { createPermissionExtension } from "./extensions/permissions";
import { PermissionStore } from "./permission-store";
import { createGpaExtension } from "./extensions/gpa";
import { createParamCompatExtension } from "./extensions/param-compat";
import { searchProjectFiles } from "./file-search";
import {
  applyReasoningLevelOverrides,
  applySafeCustomOpenAiCompat,
  forceMaxCompletionTokensField,
  isMaxTokensFieldUnsupportedError,
  isReasoningEffortToolsUnsupportedError,
  maxTokensFieldForModel,
  readModelsFile,
  reasoningEffortDisabledForModel,
  setModelApi,
  setModelCompatValue,
  writeModelsFile,
} from "./models-file";
import {
  createPackageContext,
  importLocalSkill,
  listInstalled,
  toggleResource,
  toNpmSource,
  type PackageContext,
} from "./package-ops";
import { buildSnapshot, collectDisplayMessages, mergeWatchdogIntoMessages, serializeTree } from "./serialize";

type EventSink = (event: StreamEvent) => void;

/** 400 兜底支持的参数不兼容类型。 */
type ParameterRecoveryKind = "max-tokens" | "reasoning-effort" | "responses-unavailable";

export class AgentHost {
  private modelRuntime: ModelRuntime | undefined;
  private runtime: AgentSessionRuntime | undefined;
  private unsubscribe: (() => void) | undefined;
  private queue = { steering: [] as string[], followUp: [] as string[] };
  /**
   * 队列消息的图片附件（文本 → 图片）：pi 的队列镜像只含文本，
   * 编辑/删除队列消息需要清空重建，重建时用它恢复附件。
   */
  private queuedImages = new Map<string, PromptImage[]>();
  /** 重建队列期间（clearQueue → 重新入队）暂停图片映射的清理，避免误删尚未重建的条目。 */
  private restoringQueue = false;
  /** 队列操作（删除/编辑/转 steer）的串行执行链，避免并发重建互相覆盖。 */
  private queueMutationChain: Promise<void> = Promise.resolve();
  private cwd = homedir();
  private activityLabel = "";
  private activityStartedAt = 0;
  private activityTimer: ReturnType<typeof setInterval> | undefined;
  private gpaState: GpaState = createDefaultGpaState();
  /**
   * GPA ACT 自动续跑基线：上次自动续跑时的已完成任务数。
   * 与 workagent 一致：ACT 未完成时默认续跑，不因「更新计划」而停下来等用户输入继续。
   */
  private gpaAutoContinueDone = 0;
  /** 连续无进展续跑次数。超过上限才停，避免模型空转。 */
  private gpaAutoContinueStreak = 0;
  private gpaAutoContinuing = false;
  /** 用户中止后跳过下一次自动续跑，避免立刻又被拉起来。 */
  private gpaSkipNextAutoContinue = false;
  /** 最近一次 PLAN 正文，写入 .pi-plan/gpa-plan.md 供关闭后恢复。 */
  private gpaPlanBody = "";
  /** 当前助手消息的流式正文，供 Updated Plan 实时解析。 */
  private streamingAssistantText = "";
  private gpaLiveTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly permissionStore = new PermissionStore();
  private static readonly MAX_GPA_NO_PROGRESS_CONTINUES = 2;
  private static readonly GPA_LIVE_UPDATE_MS = 120;
  private watchdogTimer: ReturnType<typeof setInterval> | undefined;
  private watchdogIdleTimer: ReturnType<typeof setTimeout> | undefined;
  private watchdogAbort: AbortController | undefined;
  private watchdogRound = 0;
  private watchdogTurnStartedAt = 0;
  private watchdogReports: WatchdogReport[] = [];
  private recentToolLog: string[] = [];
  /** 已提示过参数名改写的模型，避免每个请求都弹一次 toast。 */
  private paramCompatNotified = new Set<string>();
  /** 已做过 400 兜底修正的模型（provider/id），同一会话每个模型每类错误只自动重试一次。 */
  private recoveredParameters = new Set<string>();
  /** 等待下一个空闲点执行的 400 兜底（不在流式回合中插手）。 */
  private pendingParameterRecovery: { kind: ParameterRecoveryKind; provider: string; id: string } | undefined;

  constructor(
    private readonly dialogs: DialogBroker,
    private readonly emit: EventSink,
  ) {}

  async initialize(): Promise<void> {
    this.modelRuntime = await ModelRuntime.create({
      allowModelNetwork: true,
      refreshOnCreate: true,
    });
    await this.sanitizeModelsFile();
  }

  isBusy(): boolean {
    const session = this.runtime?.session;
    return Boolean(session?.isStreaming || session?.isCompacting || this.activityTimer);
  }

  pushUiSnapshot(): void {
    this.pushSnapshot();
  }

  getCwd(): string {
    return this.cwd;
  }

  private requireRuntime(): AgentSessionRuntime {
    if (!this.runtime) {
      throw new Error("请先打开一个项目目录");
    }
    return this.runtime;
  }

  private requireSession() {
    return this.requireRuntime().session;
  }

  private requireModels(): ModelRuntime {
    if (!this.modelRuntime) {
      throw new Error("模型运行时尚未初始化");
    }
    return this.modelRuntime;
  }

  private modelsPath(): string {
    return join(getAgentDir(), "models.json");
  }

  private customModelConfig(provider: string, id: string) {
    return this.getModelsFile().file.providers?.[provider]?.models?.find((entry) => entry.id === id);
  }

  private preferredThinkingLevel(provider: string, id: string): ThinkingLevel | undefined {
    const custom = this.customModelConfig(provider, id)?.defaultThinkingLevel;
    if (custom && VALID_THINKING_LEVELS.has(custom as ThinkingLevel)) return custom as ThinkingLevel;
    const perModel = this.runtime?.services.settingsManager.getModelThinkingLevel(provider, id);
    if (perModel && VALID_THINKING_LEVELS.has(perModel)) return perModel;
    const global = this.runtime?.services.settingsManager.getDefaultThinkingLevel();
    if (global && VALID_THINKING_LEVELS.has(global)) return global;
    return undefined;
  }

  private thinkingLevelsForModel(provider: string, id: string, reasoning?: boolean): ThinkingLevel[] {
    const custom = this.customModelConfig(provider, id);
    const configured = orderedThinkingLevels(custom?.thinkingLevels ?? []);
    if (configured.length > 0) return configured;
    return reasoning || custom?.reasoning ? [...DEFAULT_REASONING_LEVELS] : ["off"];
  }

  private thinkingLevelsForCurrentModel(): ThinkingLevel[] {
    const model = this.runtime?.session?.model;
    if (!model) return ["off"];
    return this.thinkingLevelsForModel(model.provider, model.id, model.reasoning);
  }

  /**
   * 服务端 400 兜底：判定属于哪类参数不兼容，登记一次修正 + 重发。
   * 同一模型同一类错误只处理一次，避免配置本身修不好时无限重试。
   */
  private noteProviderParameterError(message: { stopReason?: string; errorMessage?: string }): void {
    if (message.stopReason !== "error") return;
    const model = this.runtime?.session?.model;
    if (!model) return;
    const kind: ParameterRecoveryKind | undefined = isMaxTokensFieldUnsupportedError(message.errorMessage)
      ? "max-tokens"
      : isReasoningEffortToolsUnsupportedError(message.errorMessage)
        ? "reasoning-effort"
        // 切到 responses 后才发现网关没有该端点：退回 completions 并关闭思考。
        : model.api === "openai-responses" && /\b404\b|not found|无法找到|不存在/i.test(message.errorMessage ?? "")
          ? "responses-unavailable"
          : undefined;
    if (!kind) return;
    const key = `${kind}:${model.provider}/${model.id}`;
    if (this.recoveredParameters.has(key)) return;
    this.recoveredParameters.add(key);
    this.pendingParameterRecovery = { kind, provider: model.provider, id: model.id };
  }

  /** 按错误类型修正 models.json，成功时返回提示文案；返回 undefined 表示不重试。 */
  private async applyProviderParameterFix(target: { kind: ParameterRecoveryKind; provider: string; id: string }): Promise<string | undefined> {
    const file = this.getModelsFile().file;
    if (target.kind === "max-tokens") {
      if (!forceMaxCompletionTokensField(file, target.id)) return undefined;
      writeModelsFile(this.modelsPath(), file);
      await this.requireModels().refresh({ allowNetwork: false });
      return `${target.id} 不支持 max_tokens，已切换为 max_completion_tokens…`;
    }
    if (target.kind === "responses-unavailable") {
      return await this.applyResponsesUnavailableFix(target);
    }

    // reasoning_effort 与 function tools 在 chat/completions 下互斥：
    // 优先切到 responses（工具 + 思考都保住），网关没有 responses 时降级为关闭思考。
    const responsesAvailable = await this.probeResponsesEndpoint(target.provider, target.id);
    if (responsesAvailable) {
      const changedApi = setModelApi(file, target.id, "openai-responses");
      const changedLevels = applyReasoningLevelOverrides(file);
      if (!changedApi && !changedLevels) return undefined;
      writeModelsFile(this.modelsPath(), file);
      await this.requireModels().refresh({ allowNetwork: false });
      return `${target.id} 在 chat/completions 下不支持 tools + reasoning，已切换到 responses…`;
    }
    if (!setModelCompatValue(file, target.id, "supportsReasoningEffort", false)) return undefined;
    writeModelsFile(this.modelsPath(), file);
    await this.requireModels().refresh({ allowNetwork: false });
    return `${target.id} 不支持 tools + reasoning，已关闭 reasoning_effort（工具仍可用）…`;
  }

  /** 网关没有 /responses：退回 chat/completions 并关闭思考，且不能再被配置层翻回去。 */
  private async applyResponsesUnavailableFix(target: { provider: string; id: string }): Promise<string | undefined> {
    const file = this.getModelsFile().file;
    const changedApi = setModelApi(file, target.id, "openai-completions");
    const changedCompat = setModelCompatValue(file, target.id, "supportsReasoningEffort", false);
    if (!changedApi && !changedCompat) return undefined;
    writeModelsFile(this.modelsPath(), file);
    await this.requireModels().refresh({ allowNetwork: false });
    return `${target.id} 的网关没有 /responses，已回到 chat/completions 并关闭 reasoning_effort（工具可用）…`;
  }

  /** 修正配置并重发上一条用户消息（每模型每类错误仅一次）。 */
  private async recoverProviderParameter(target: { kind: ParameterRecoveryKind; provider: string; id: string }): Promise<void> {
    try {
      const message = await this.applyProviderParameterFix(target);
      if (!message) {
        this.emit({
          type: "toast",
          toastType: "error",
          message: `${target.id} 的参数已符合要求仍被拒绝，请检查网关设置（未自动重试）`,
        });
        return;
      }
      const fresh = this.requireModels().getModel(target.provider, target.id);
      if (fresh) await this.requireSession().setModel(fresh);
      this.emit({ type: "toast", toastType: "info", message });
      // GPA 自动续跑正在进行时不再插一条重发，避免两条消息互相干扰。
      if (this.gpaAutoContinuing) return;
      const text = this.lastUserPromptText();
      if (!text) return;
      await this.requireSession().prompt(text);
    } catch (error) {
      this.emit({
        type: "toast",
        toastType: "error",
        message: `自动修正请求参数失败：${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  /** 探测网关是否提供 /responses（404 视为没有）；401/400 等说明端点存在。 */
  private async probeResponsesEndpoint(providerId: string, modelId: string): Promise<boolean> {
    const provider = this.getModelsFile().file.providers?.[providerId];
    const baseUrl = provider?.baseUrl?.trim();
    if (!baseUrl) return false;
    const url = `${baseUrl.replace(/\/+$/, "")}/responses`;
    const apiKey = provider?.apiKey;
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
          ...(provider?.headers ?? {}),
        },
        body: JSON.stringify({ model: modelId, input: "ping", stream: false, max_output_tokens: 16 }),
        signal: AbortSignal.timeout(15_000),
      });
      await response.body?.cancel().catch(() => undefined);
      return response.status !== 404;
    } catch {
      return false;
    }
  }

  /** 取出最近一条用户消息的纯文本，用于 400 兜底后重发。 */
  private lastUserPromptText(): string | undefined {
    const messages = (this.runtime?.session?.messages ?? []) as { role?: string; content?: unknown }[];
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (message?.role !== "user") continue;
      if (typeof message.content === "string") return message.content.trim() || undefined;
      if (!Array.isArray(message.content)) return undefined;
      const text = message.content
        .filter((part): part is { type?: string; text?: string } => typeof part === "object" && part !== null)
        .filter((part) => part.type === "text" && typeof part.text === "string")
        .map((part) => part.text as string)
        .join("\n")
        .trim();
      return text || undefined;
    }
    return undefined;
  }

  /**
   * 1. 勾了思考等级但没写 reasoning 时补上，桌面思考档位才能生效。
   * 2. 对非官方 OpenAI 网关按模型补 compat：DeepSeek 发 thinking，GPT 用 max_completion_tokens。
   */
  private async sanitizeModelsFile(): Promise<void> {
    const { file } = this.getModelsFile();
    let changed = false;
    for (const provider of Object.values(file.providers ?? {})) {
      for (const model of provider.models ?? []) {
        const wantsReasoning =
          Boolean(model.reasoning) ||
          (model.thinkingLevels?.length ?? 0) > 0 ||
          Boolean(model.defaultThinkingLevel);
        if (wantsReasoning && !model.reasoning) {
          model.reasoning = true;
          changed = true;
        }
      }
    }
    const compat = applySafeCustomOpenAiCompat(file);
    if (!changed && !compat.changed) return;
    writeModelsFile(this.modelsPath(), compat.file);
    await this.requireModels().refresh({ allowNetwork: false });
    const session = this.runtime?.session;
    const current = session?.model;
    if (!current) return;
    const fresh = this.requireModels().getModel(current.provider, current.id);
    if (fresh) await session.setModel(fresh);
  }

  private async migrateModelReasoningFlags(): Promise<void> {
    await this.sanitizeModelsFile();
  }

  private async ensureModelReasoning(provider: string, id: string): Promise<void> {
    await this.sanitizeModelsFile();
    const session = this.runtime?.session;
    const current = session?.model;
    if (!current || current.provider !== provider || current.id !== id) return;
    if (current.reasoning) return;
    const fresh = this.requireModels().getModel(provider, id);
    if (fresh?.reasoning) {
      await session.setModel(fresh);
    }
  }

  private async resolveTrust(cwd: string, extensionsResult?: LoadExtensionsResult): Promise<boolean> {
    if (!hasTrustRequiringProjectResources(cwd)) return true;
    const store = new ProjectTrustStore(getAgentDir());
    const existing = store.get(cwd);
    if (existing !== null) return existing;

    const parent = dirname(cwd);
    const options = ["信任此文件夹", "不信任项目级配置"];
    if (parent !== cwd) options.splice(1, 0, `同时信任父目录 (${parent})`);
    const selected = await this.dialogs.select(
      `是否信任项目文件夹？\n${cwd}\n\n信任后会加载项目内的 .pi 设置、扩展、Skills，并允许安装项目包。`,
      options,
    );
    if (!selected || selected.startsWith("不信任")) {
      store.set(cwd, false);
      return false;
    }
    if (selected.startsWith("同时信任")) {
      store.set(parent, true);
      return true;
    }
    store.set(cwd, true);
    void extensionsResult;
    return true;
  }

  private collectResources(): ResourceSummary {
    const loader = this.runtime?.services.resourceLoader;
    if (!loader) {
      return { skills: [], prompts: [], extensions: [], agentsFiles: [] };
    }
    const skills = loader.getSkills().skills.map((skill) => ({
      name: skill.name,
      description: skill.description,
    }));
    const prompts = loader.getPrompts().prompts.map((prompt) => ({
      name: prompt.name,
      description: prompt.description,
    }));
    const extensions = loader.getExtensions().extensions.map((ext) => ({
      name: ext.path,
      path: ext.path,
    }));
    const agentsFiles = loader.getAgentsFiles().agentsFiles.map((file) => ({ path: file.path }));
    return { skills, prompts, extensions, agentsFiles };
  }

  snapshot(): SessionSnapshot | undefined {
    const runtime = this.runtime;
    if (!runtime) return undefined;
    const session = runtime.session;
    const model = session.model;
    return buildSnapshot({
      cwd: runtime.cwd,
      sessionId: session.sessionId,
      sessionName: session.sessionName,
      sessionFile: session.sessionFile,
      messages: mergeWatchdogIntoMessages(collectDisplayMessages(session), this.watchdogReports),
      isStreaming: session.isStreaming,
      isCompacting: session.isCompacting,
      model: model
        ? {
            provider: model.provider,
            id: model.id,
            name: model.name,
            contextWindow: model.contextWindow,
            maxTokens: model.maxTokens,
            reasoning: model.reasoning,
          }
        : undefined,
      thinkingLevel: session.thinkingLevel,
      availableThinkingLevels: this.thinkingLevelsForCurrentModel(),
      resources: this.collectResources(),
      diagnostics: [...runtime.diagnostics],
      modelFallbackMessage: runtime.modelFallbackMessage,
      projectTrusted: runtime.services.settingsManager.isProjectTrusted(),
      fullTrust: this.permissionStore.isFullTrust(this.runtime?.cwd ?? this.cwd),
      queue: this.queue,
      contextUsage: session.getContextUsage(),
      gpa: this.gpaState,
      gpaPlanResume: this.gpaResumePreview(),
      watchdogReports: this.watchdogReports,
    });
  }

  private pushSnapshot(): void {
    const snapshot = this.snapshot();
    if (snapshot) this.emit({ type: "snapshot", snapshot });
  }

  private setActivity(message: string): void {
    const now = Date.now();
    if (!this.activityStartedAt) this.activityStartedAt = now;
    const unchanged = this.activityLabel === message && Boolean(this.activityTimer);
    this.activityLabel = message;
    if (!unchanged) {
      this.emit({
        type: "activity",
        message,
        elapsed: now - this.activityStartedAt,
      });
    }
    if (this.activityTimer) return;
    this.activityTimer = setInterval(() => {
      if (!this.activityStartedAt) return;
      this.emit({
        type: "activity",
        message: this.activityLabel || "仍在处理",
        elapsed: Date.now() - this.activityStartedAt,
      });
    }, 4000);
  }

  private clearActivity(): void {
    if (this.activityTimer) {
      clearInterval(this.activityTimer);
      this.activityTimer = undefined;
    }
    this.activityStartedAt = 0;
    this.activityLabel = "";
    this.emit({ type: "activity", message: "", elapsed: 0 });
  }

  private extensionUi() {
    return {
      select: async (title: string, options: string[]) => this.dialogs.select(title, options),
      confirm: async (title: string, message: string) => this.dialogs.confirm(title, message),
      input: async (title: string, placeholder?: string) => this.dialogs.input(title, placeholder),
      notify: (message: string, type: "info" | "warning" | "error" = "info") => {
        this.emit({ type: "toast", toastType: type, message });
      },
      onTerminalInput: () => () => undefined,
      setStatus: () => undefined,
      setWorkingMessage: (message?: string) => {
        if (message) this.setActivity(message);
      },
      setWorkingVisible: (visible?: boolean) => {
        if (visible === false) this.clearActivity();
      },
      setWorkingIndicator: () => undefined,
      setHiddenThinkingLabel: () => undefined,
      setWidget: () => undefined,
      setFooter: () => undefined,
      setHeader: () => undefined,
      setTitle: () => undefined,
      custom: async () => {
        this.emit({
          type: "toast",
          toastType: "warning",
          message: "该扩展使用了 TUI 专用 custom() 组件，桌面端无法原样渲染。",
        });
        return undefined;
      },
    };
  }

  private async attachSession(): Promise<void> {
    this.stopWatchdog();
    this.watchdogReports = [];
    this.watchdogRound = 0;
    this.unsubscribe?.();
    const session = this.requireSession();
    await session.bindExtensions({
      uiContext: this.extensionUi() as never,
      mode: "tui",
      onError: (error: { extensionPath?: string; error?: string }) => {
        this.emit({
          type: "toast",
          toastType: "error",
          message: `扩展错误 ${error.extensionPath ?? ""}: ${error.error ?? "unknown"}`,
        });
      },
    });
    this.unsubscribe = session.subscribe((event) => {
      this.handleSessionEvent(event as { type: string; [key: string]: unknown });
    });
    this.pushSnapshot();
  }

  private handleSessionEvent(event: { type: string; [key: string]: unknown }): void {
    if (event.type === "agent_start") {
      this.setActivity("正在连接模型…");
      this.startWatchdogIfNeeded();
      return;
    }
    if (event.type === "message_start") {
      const role = (event.message as { role?: string } | undefined)?.role;
      if (role === "user") this.setActivity("已收到消息，正在思考…");
      else if (role === "assistant") {
        this.streamingAssistantText = "";
        this.setActivity("模型正在回复…");
      }
      return;
    }
    if (event.type === "message_update") {
      const assistantEvent = event.assistantMessageEvent as { type?: string; delta?: string } | undefined;
      if (assistantEvent?.type === "text_delta" && assistantEvent.delta) {
        this.setActivity("正在输出回复…");
        this.streamingAssistantText += assistantEvent.delta;
        this.scheduleLiveGpaUpdate();
        this.emit({ type: "text_delta", delta: assistantEvent.delta });
        return;
      }
      if (assistantEvent?.type === "thinking_delta" && assistantEvent.delta) {
        this.setActivity("正在思考…");
        this.emit({ type: "thinking_delta", delta: assistantEvent.delta });
        return;
      }
    }
    if (event.type === "tool_execution_start") {
      const toolName = String(event.toolName ?? "工具");
      this.recentToolLog = [...this.recentToolLog, toolName].slice(-8);
      this.setActivity(`正在执行 ${toolName}…`);
      this.emit({
        type: "tool_start",
        toolCallId: String(event.toolCallId ?? ""),
        toolName,
        args: event.args,
      });
      return;
    }
    if (event.type === "tool_execution_update") {
      const toolName = String(event.toolName ?? "工具");
      this.setActivity(`正在执行 ${toolName}，请稍候…`);
      this.emit({
        type: "tool_update",
        toolCallId: String(event.toolCallId ?? ""),
        toolName: String(event.toolName ?? ""),
        args: event.args,
        result: event.partialResult,
      });
      return;
    }
    if (event.type === "tool_execution_end") {
      this.setActivity("工具已完成，继续处理…");
      this.emit({
        type: "tool_end",
        toolCallId: String(event.toolCallId ?? ""),
        toolName: String(event.toolName ?? ""),
        result: event.result,
        isError: Boolean(event.isError),
      });
      this.pushSnapshot();
      return;
    }
    if (event.type === "bash_execution_update") {
      this.setActivity("正在运行命令…");
      this.emit({ type: "bash_delta", delta: String(event.delta ?? "") });
      return;
    }
    if (event.type === "queue_update") {
      this.queue = {
        steering: [...((event.steering as string[]) ?? [])],
        followUp: [...((event.followUp as string[]) ?? [])],
      };
      // 消息被消费（离开队列）后清理其图片映射；重建期间跳过，避免误删尚未重建的条目
      if (!this.restoringQueue) this.pruneQueuedImages();
      this.emit({ type: "queue_update", steering: this.queue.steering, followUp: this.queue.followUp });
      return;
    }
    if (event.type === "compaction_start") {
      this.setActivity("正在压缩上下文…");
      this.emit({ type: "compaction", reason: String(event.reason ?? event.type), message: event.errorMessage as string });
      this.pushSnapshot();
      return;
    }
    if (event.type === "compaction_end") {
      this.setActivity(event.aborted ? "压缩已结束" : "压缩完成，继续回复…");
      this.emit({ type: "compaction", reason: String(event.reason ?? event.type), message: event.errorMessage as string });
      this.pushSnapshot();
      return;
    }
    if (event.type === "auto_retry_start") {
      this.setActivity(`请求失败，正在重试（${String(event.attempt ?? "")}/${String(event.maxAttempts ?? "")}）…`);
      return;
    }
    if (event.type === "agent_end") {
      if (event.willRetry) this.setActivity("准备重试…");
      this.pushSnapshot();
      return;
    }
    if (event.type === "agent_settled") {
      this.armWatchdogIdleStop();
      this.clearActivity();
      this.flushLiveGpaUpdate();
      this.updateGpaFromMessages();
      this.pushSnapshot();
      // ACT 阶段：任务有推进时自动发送下一条指令，避免每完成一项都要用户手动"继续"。
      // 延迟到当前事件循环之后，确保 settled 收尾流程结束再启动新的 run。
      setTimeout(() => void this.maybeAutoContinueGpa(), 0);
      const recovery = this.pendingParameterRecovery;
      if (recovery) {
        this.pendingParameterRecovery = undefined;
        void this.recoverProviderParameter(recovery);
      }
      return;
    }
    if (event.type === "message_end") {
      const message = event.message as { role?: string; content?: unknown; stopReason?: string; errorMessage?: string } | undefined;
      if (message?.role === "assistant") {
        this.noteProviderParameterError(message);
        this.flushLiveGpaUpdate();
        // Update GPA on every assistant message so ACT progress is live within
        // a single agent turn (agent_settled only fires once per turn).
        this.updateGpaFromMessages(contentToText(message.content));
      }
      this.streamingAssistantText = "";
      this.pushSnapshot();
      return;
    }
    if (event.type === "session_info_changed" || event.type === "thinking_level_changed") {
      this.pushSnapshot();
    }
  }

  private createFactory(): CreateAgentSessionRuntimeFactory {
    return async ({ cwd, sessionManager, sessionStartEvent, projectTrustContext }) => {
      void projectTrustContext;
      const services = await createAgentSessionServices({
        cwd,
        modelRuntime: this.requireModels(),
        resourceLoaderOptions: {
          extensionFactories: [
            createPermissionExtension(this.dialogs, this.permissionStore, () => this.cwd),
            createGpaExtension(() => this.gpaState, this.dialogs),
            createParamCompatExtension({
              expectedMaxTokensField: (modelId) => maxTokensFieldForModel(this.getModelsFile().file, modelId),
              reasoningEffortDisabled: (modelId) => reasoningEffortDisabledForModel(this.getModelsFile().file, modelId),
              onRewrite: ({ modelId, from, to }) => {
                const key = `${modelId}:${from}`;
                if (this.paramCompatNotified.has(key)) return;
                this.paramCompatNotified.add(key);
                this.emit({
                  type: "toast",
                  toastType: "info",
                  message: `${modelId} 不支持 ${from}，已自动改写为 ${to}`,
                });
              },
            }),
          ],
        },
        resourceLoaderReloadOptions: {
          resolveProjectTrust: async ({ extensionsResult }) => this.resolveTrust(cwd, extensionsResult),
        },
      });
      const created = await createAgentSessionFromServices({
        services,
        sessionManager,
        sessionStartEvent,
      });
      const result: CreateAgentSessionRuntimeResult = {
        ...created,
        services,
        diagnostics: services.diagnostics,
      };
      return result;
    };
  }

  async openProject(cwd: string): Promise<SessionSnapshot> {
    if (this.runtime) {
      this.unsubscribe?.();
      await this.runtime.dispose();
      this.runtime = undefined;
    }
    this.cwd = cwd;
    this.queue = { steering: [], followUp: [] };
    this.queuedImages.clear();
    this.resetGpaRuntime();
    this.permissionStore.clearSession();
    const factory = this.createFactory();
    this.runtime = await createAgentSessionRuntime(factory, {
      cwd,
      agentDir: getAgentDir(),
      sessionManager: SessionManager.continueRecent(cwd),
    });
    this.runtime.setRebindSession(async () => {
      await this.attachSession();
    });
    this.runtime.setBeforeSessionInvalidate(() => {
      this.unsubscribe?.();
      this.unsubscribe = undefined;
    });
    await this.attachSession();
    const model = this.runtime?.session?.model;
    if (model) await this.ensureModelReasoning(model.provider, model.id);
    await this.softRestoreGpaPlanFromFile();
    const snapshot = this.snapshot();
    if (!snapshot) throw new Error("打开项目失败");
    return snapshot;
  }

  async prompt(payload: PromptPayload): Promise<void> {
    const session = this.requireSession();
    const text = payload.text;
    this.maybeAdvanceGpaOnConfirmation(text);
    if (text.startsWith("!")) {
      const excluded = text.startsWith("!!");
      const command = excluded ? text.slice(2).trim() : text.slice(1).trim();
      if (command) {
        this.setActivity("正在运行命令…");
        try {
          await session.executeBash(command, undefined, { excludeFromContext: excluded });
        } finally {
          this.clearActivity();
          this.pushSnapshot();
        }
        return;
      }
    }

    this.setActivity("正在提交消息…");
    // 流式对话中追加的消息默认进入 follow-up 队列（等待当前回合结束后发送）
    const streamingBehavior = session.isStreaming ? payload.streamingBehavior ?? "followUp" : undefined;
    // 记录入队消息的图片附件，供编辑/删除重建队列时恢复
    if (streamingBehavior && payload.images && payload.images.length > 0) {
      this.queuedImages.set(text, payload.images);
    }
    await new Promise<void>((resolve, reject) => {
      let accepted = false;
      void session
        .prompt(text, {
          images: payload.images,
          streamingBehavior,
          preflightResult: (success) => {
            if (!success || accepted) return;
            accepted = true;
            resolve();
          },
        })
        .then(() => {
          this.pushSnapshot();
          if (!accepted) resolve();
        })
        .catch((error: unknown) => {
          this.clearActivity();
          this.pushSnapshot();
          const wrapped = error instanceof Error ? error : new Error(String(error));
          if (!accepted) {
            reject(wrapped);
            return;
          }
          this.emit({ type: "toast", toastType: "error", message: wrapped.message });
        });
    });
  }

  async abort(): Promise<void> {
    this.gpaSkipNextAutoContinue = true;
    this.pendingParameterRecovery = undefined;
    this.stopWatchdog();
    await this.requireSession().abort();
    this.clearActivity();
    void this.persistGpaPlanFile(this.gpaPlanFileStatus());
    this.pushSnapshot();
  }

  async steer(text: string): Promise<void> {
    await this.requireSession().steer(text);
  }

  async followUp(text: string): Promise<void> {
    await this.requireSession().followUp(text);
  }

  /**
   * 修改待发送队列：删除单条、编辑文本、把 follow-up 转为 steer。
   * pi 不支持单条增删，实现为 clearQueue 后按剩余顺序重建（图片附件从映射恢复）。
   * 队列操作串行执行：并发的 clearQueue + 重建会互相覆盖导致消息丢失。
   */
  async mutateQueue(action: QueueMutation): Promise<void> {
    const run = this.queueMutationChain.then(() => this.applyQueueMutation(action));
    this.queueMutationChain = run.catch(() => undefined);
    return run;
  }

  private async applyQueueMutation(action: QueueMutation): Promise<void> {
    const session = this.requireSession();
    this.restoringQueue = true;
    try {
      const current = session.clearQueue();
      const steering = [...current.steering];
      const followUp = [...current.followUp];

      if (action.type === "remove") {
        const index = steering.indexOf(action.text);
        if (index !== -1) steering.splice(index, 1);
        else {
          const fallback = followUp.indexOf(action.text);
          if (fallback !== -1) followUp.splice(fallback, 1);
        }
      } else if (action.type === "update") {
        const newText = (action.newText ?? "").trim();
        if (!newText) throw new Error("队列消息内容不能为空");
        const index = steering.indexOf(action.text);
        if (index !== -1) steering[index] = newText;
        else {
          const fallback = followUp.indexOf(action.text);
          if (fallback !== -1) followUp[fallback] = newText;
        }
        // 图片映射随文本转移
        const images = this.queuedImages.get(action.text);
        if (images) {
          this.queuedImages.delete(action.text);
          this.queuedImages.set(newText, images);
        }
      } else if (action.type === "toSteer") {
        const index = followUp.indexOf(action.text);
        if (index !== -1) {
          followUp.splice(index, 1);
          steering.push(action.text);
        }
      }

      for (const text of steering) {
        await session.steer(text, this.queuedImages.get(text));
      }
      for (const text of followUp) {
        await session.followUp(text, this.queuedImages.get(text));
      }
    } finally {
      this.restoringQueue = false;
      this.pruneQueuedImages();
    }
  }

  /** 清理已不在队列中的消息的图片映射，避免陈旧数据累积。 */
  private pruneQueuedImages(): void {
    const pending = new Set([...this.queue.steering, ...this.queue.followUp]);
    for (const key of [...this.queuedImages.keys()]) {
      if (!pending.has(key)) this.queuedImages.delete(key);
    }
  }

  async newSession(): Promise<SessionSnapshot> {
    this.resetGpaRuntime();
    this.permissionStore.clearSession();
    const result = await this.requireRuntime().newSession();
    if (result.cancelled) throw new Error("新建会话被取消");
    await this.attachSession();
    const model = this.runtime?.session?.model;
    if (model) {
      await this.ensureModelReasoning(model.provider, model.id);
      const preferred = this.preferredThinkingLevel(model.provider, model.id);
      if (preferred) this.requireSession().setThinkingLevel(preferred);
    }
    await this.softRestoreGpaPlanFromFile();
    const snapshot = this.snapshot();
    if (!snapshot) throw new Error("新建会话失败");
    return snapshot;
  }

  async switchSession(path: string): Promise<SessionSnapshot> {
    this.resetGpaRuntime();
    this.permissionStore.clearSession();
    const result = await this.requireRuntime().switchSession(path);
    if (result.cancelled) throw new Error("切换会话被取消");
    await this.attachSession();
    await this.softRestoreGpaPlanFromFile();
    const snapshot = this.snapshot();
    if (!snapshot) throw new Error("切换会话失败");
    return snapshot;
  }

  async listSessions(): Promise<SessionListItem[]> {
    const cwd = this.runtime?.cwd ?? this.cwd;
    const sessions = await SessionManager.list(cwd);
    return sessions.map((info) => ({
      path: info.path,
      id: info.id,
      name: info.name,
      cwd: info.cwd,
      created: info.created.toISOString(),
      modified: info.modified.toISOString(),
      messageCount: info.messageCount,
      firstMessage: info.firstMessage,
    }));
  }

  /**
   * Delete a historical session file. Only paths that appear in the current
   * project's session list are accepted, so this cannot be used to remove
   * arbitrary files. Deleting the active session first switches to a fresh
   * session so the runtime never keeps appending to a deleted file.
   */
  async deleteSession(path: string): Promise<void> {
    const cwd = this.runtime?.cwd ?? this.cwd;
    const sessions = await SessionManager.list(cwd);
    if (!sessions.some((info) => samePath(info.path, path))) {
      throw new Error("会话不存在或不属于当前项目");
    }
    const current = this.runtime?.session?.sessionManager.getSessionFile();
    if (current && samePath(current, path)) {
      await this.newSession();
    }
    await rm(path, { force: true });
  }

  nameSession(name: string): void {
    this.requireSession().setSessionName(name);
    this.pushSnapshot();
  }

  async fork(entryId: string): Promise<SessionSnapshot> {
    const result = await this.requireRuntime().fork(entryId, { position: "before" });
    if (result.cancelled) throw new Error("Fork 被取消");
    await this.attachSession();
    const snapshot = this.snapshot();
    if (!snapshot) throw new Error("Fork 失败");
    return snapshot;
  }

  async clone(): Promise<SessionSnapshot> {
    const leafId = this.requireSession().sessionManager.getLeafId();
    if (!leafId) throw new Error("当前会话还没有可复制的节点");
    const result = await this.requireRuntime().fork(leafId, { position: "at" });
    if (result.cancelled) throw new Error("Clone 被取消");
    await this.attachSession();
    const snapshot = this.snapshot();
    if (!snapshot) throw new Error("Clone 失败");
    return snapshot;
  }

  /**
   * Edit a persisted user message and resend it: fork the session to just
   * before that entry, then submit the new text as a fresh turn.
   */
  async editAndResend(entryId: string, payload: PromptPayload): Promise<void> {
    const result = await this.requireRuntime().fork(entryId, { position: "before" });
    if (result.cancelled) throw new Error("编辑被取消");
    await this.attachSession();
    await this.prompt(payload);
  }

  getGpaState(): GpaState {
    return this.gpaState;
  }

  async peekGpaPlan(): Promise<GpaPlanResumePreview | null> {
    return this.readGpaResumePreview();
  }

  /**
   * GPA 开关。开启时若项目里有未完成计划，先询问是继续还是废弃后重来；
   * 关闭时把当前进度写回 .pi-plan/gpa-plan.md，下次可以接着执行。
   */
  async setGpaEnabled(enabled: boolean): Promise<GpaState> {
    if (!enabled) {
      await this.persistGpaPlanFile(this.gpaPlanFileStatus());
      this.resetGpaRuntime();
      this.pushSnapshot();
      return this.gpaState;
    }

    const preview = await this.readGpaResumePreview();
    if (preview) {
      const choice = await this.dialogs.select(
        `发现未完成的 GPA 计划（已完成 ${preview.doneCount}/${preview.tasks.length}，剩余 ${preview.pendingCount} 项）`,
        ["继续执行剩余任务", "重新开始（废弃旧计划）"],
      );
      if (!choice) {
        this.pushSnapshot();
        return this.gpaState;
      }
      if (choice === "重新开始（废弃旧计划）") {
        await this.abandonGpaPlanFile();
      } else {
        const restored = await this.tryRestoreGpaPlanFromFile();
        this.pushSnapshot();
        if (restored && this.gpaState.stage === "act") {
          await this.resumeGpaPlan();
        }
        return this.gpaState;
      }
    }

    this.gpaState = { ...createDefaultGpaState(), stage: "goal", updatedAt: new Date().toISOString() };
    this.gpaPlanBody = "";
    this.gpaAutoContinueDone = 0;
    this.gpaAutoContinueStreak = 0;
    this.pushSnapshot();
    return this.gpaState;
  }

  /**
   * User confirmed the current stage. Advance the state machine and send a
   * short instruction so the model continues in the next stage.
   */
  async confirmGpa(): Promise<void> {
    const stage = this.gpaState.stage;
    if (stage !== "goal" && stage !== "plan") return;
    this.advanceGpaStage();
    const message =
      stage === "goal"
        ? "[internal:gpa-confirm] Continue with the confirmed goal. Produce the PLAN task list and acceptance criteria. Every atomic task heading must use exactly `### T1: Task title`."
        : "[internal:gpa-confirm] The plan is confirmed. Enter ACT and implement the planned tasks in order. After each task, output `✅ 任务 {ID} 完成` and immediately continue the next unfinished task. Do not wait for the user to type 继续.";
    await this.prompt({ text: message });
  }

  async resumeGpaPlan(): Promise<void> {
    if (this.gpaState.stage === "off") {
      const restored = await this.tryRestoreGpaPlanFromFile();
      if (!restored) {
        this.emit({ type: "toast", toastType: "info", message: "没有可继续的 GPA 计划。" });
        return;
      }
    }
    if (this.gpaState.stage === "plan") {
      this.pushSnapshot();
      return;
    }
    if (this.gpaState.stage !== "act") return;
    const pending = this.gpaState.planTasks.filter((task) => !task.done);
    if (pending.length === 0) return;
    this.gpaSkipNextAutoContinue = false;
    this.gpaAutoContinueStreak = 0;
    await this.prompt({ text: buildGpaResumePrompt(pending.length) });
  }

  async resetGpa(): Promise<GpaState> {
    await this.abandonGpaPlanFile();
    this.resetGpaRuntime();
    this.pushSnapshot();
    return this.gpaState;
  }

  async abandonGpaPlan(): Promise<GpaState> {
    return this.resetGpa();
  }

  /** Move to the next stage without sending a message (used by text confirmation). */
  private advanceGpaStage(): void {
    const stage = this.gpaState.stage;
    if (stage === "goal") {
      this.gpaState = {
        ...this.gpaState,
        stage: "plan",
        awaitingConfirmation: null,
        updatedAt: new Date().toISOString(),
      };
    } else if (stage === "plan") {
      const text = this.latestAssistantText();
      const canonical = parseCanonicalGpaPlanTasks(text);
      const tasks = canonical.length > 0 ? canonical : parseGpaPlanTasks(text);
      if (text.trim()) this.gpaPlanBody = text;
      this.gpaState = {
        ...this.gpaState,
        stage: "act",
        planTasks: tasks.length > 0 ? tasks : this.gpaState.planTasks,
        awaitingConfirmation: null,
        updatedAt: new Date().toISOString(),
      };
      this.gpaAutoContinueDone = 0;
      this.gpaAutoContinueStreak = 0;
      this.gpaSkipNextAutoContinue = false;
      void this.persistGpaPlanFile("in_progress", this.gpaState.planTasks, this.gpaPlanBody);
    }
    this.pushSnapshot();
  }

  /** A short confirmation message (e.g. "确认") advances the pending stage. */
  private maybeAdvanceGpaOnConfirmation(text: string): void {
    if (this.gpaState.stage === "off" || !this.gpaState.awaitingConfirmation) return;
    if (!detectGpaConfirmation(text) && !/\[internal:gpa-confirm\]/i.test(text)) return;
    this.advanceGpaStage();
  }

  listPermissionRules(): string[] {
    return this.permissionStore.listAlways();
  }

  forgetPermissionRule(key: string): string[] {
    this.permissionStore.forgetAlways(key);
    return this.permissionStore.listAlways();
  }

  clearPermissionRules(): string[] {
    this.permissionStore.clearAlways();
    return this.permissionStore.listAlways();
  }

  private latestAssistantText(): string {
    const session = this.runtime?.session;
    if (!session) return "";
    const messages = session.messages as Array<{ role?: string; content?: unknown }>;
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (message.role !== "assistant") continue;
      return contentToText(message.content);
    }
    return "";
  }

  private scheduleLiveGpaUpdate(): void {
    if (this.gpaState.stage === "off") return;
    if (this.gpaLiveTimer) return;
    this.gpaLiveTimer = setTimeout(() => {
      this.gpaLiveTimer = undefined;
      this.updateGpaFromMessages(this.streamingAssistantText, { live: true });
    }, AgentHost.GPA_LIVE_UPDATE_MS);
  }

  private flushLiveGpaUpdate(): void {
    if (!this.gpaLiveTimer) return;
    clearTimeout(this.gpaLiveTimer);
    this.gpaLiveTimer = undefined;
    if (this.streamingAssistantText) {
      this.updateGpaFromMessages(this.streamingAssistantText, { live: true });
    }
  }

  private gpaStateChanged(previous: GpaState, next: GpaState): boolean {
    if (previous.stage !== next.stage) return true;
    if (previous.awaitingConfirmation !== next.awaitingConfirmation) return true;
    if (previous.planTasks.length !== next.planTasks.length) return true;
    return previous.planTasks.some(
      (task, index) => task.id !== next.planTasks[index]?.id || task.title !== next.planTasks[index]?.title || task.done !== next.planTasks[index]?.done,
    );
  }

  /** Derive GPA plan/ACT progress from the latest assistant message. */
  private updateGpaFromMessages(textOverride?: string, options?: { live?: boolean }): void {
    if (this.gpaState.stage === "off") return;
    const text = textOverride ?? this.latestAssistantText();
    const previous = this.gpaState;
    let next = this.gpaState;
    if (text) {
      if (next.stage === "plan") {
        next = { ...next, planTasks: liveReconcileGpaPlanTasks(next.planTasks, text) };
        if (text.trim()) this.gpaPlanBody = text;
      }
      if (next.stage === "act") {
        const declarations = parseGpaCompletedTaskDeclarations(text, next.planTasks);
        for (const declaration of declarations) {
          next = applyCompletedPlanTasks(next, declaration.taskIds);
        }
        next = applyCompletedPlanTasks(next, parseGpaCheckboxCompletions(text, next.planTasks));
        next = { ...next, planTasks: normalizeSequentialPlanTasks(next.planTasks) };
      }
    }
    // GOAL / PLAN wait for an explicit user confirmation to advance.
    if (next.stage === "goal" || next.stage === "plan") {
      next = { ...next, awaitingConfirmation: next.stage };
    }
    const finishedAct =
      next.stage === "act" && next.planTasks.length > 0 && next.planTasks.every((task) => task.done);
    // A fully completed ACT ends the one-shot GPA workflow. During streaming, wait for settle.
    if (finishedAct && !options?.live) {
      void this.persistGpaPlanFile(
        "completed",
        next.planTasks.map((task) => ({ ...task, done: true })),
      );
      next = { ...next, stage: "off", awaitingConfirmation: null };
      this.emit({ type: "toast", toastType: "info", message: "GPA 流程已完成，已自动关闭。" });
    }
    const changed = this.gpaStateChanged(previous, next);
    this.gpaState = { ...next, updatedAt: changed ? new Date().toISOString() : previous.updatedAt };
    if (options?.live) {
      if (changed) this.emit({ type: "gpa", gpa: this.gpaState });
      return;
    }
    if (!finishedAct && this.gpaState.planTasks.length > 0) {
      const progressed =
        previous.planTasks.filter((task) => task.done).length !==
        this.gpaState.planTasks.filter((task) => task.done).length;
      if (this.gpaState.stage === "plan" || progressed) {
        void this.persistGpaPlanFile(this.gpaPlanFileStatus());
      }
    }
  }

  /**
   * ACT 自动续跑，对齐 workagent 的 terminal disposition：
   * 计划未全部完成且不是在等用户决策时，必须继续下一项，不能因 update plan 停住。
   */
  private async maybeAutoContinueGpa(): Promise<void> {
    if (this.gpaAutoContinuing) return;
    if (this.gpaSkipNextAutoContinue) {
      this.gpaSkipNextAutoContinue = false;
      return;
    }
    if (this.gpaState.stage !== "act") return;
    if (this.dialogs.hasPending()) return;
    const tasks = this.gpaState.planTasks;
    if (tasks.length === 0) return;
    const doneCount = tasks.filter((task) => task.done).length;
    if (doneCount >= tasks.length) return;
    if (this.queue.steering.length > 0 || this.queue.followUp.length > 0) return;
    const nextTask = tasks.find((task) => !task.done);
    if (!nextTask) return;

    const madeProgress = doneCount > this.gpaAutoContinueDone;
    if (madeProgress) {
      this.gpaAutoContinueStreak = 0;
    } else {
      this.gpaAutoContinueStreak += 1;
      if (this.gpaAutoContinueStreak > AgentHost.MAX_GPA_NO_PROGRESS_CONTINUES) return;
    }
    this.gpaAutoContinueDone = doneCount;
    this.gpaAutoContinuing = true;
    try {
      await this.prompt({
        text: buildGpaContinuePrompt({ nextTask, doneCount, totalCount: tasks.length }),
      });
    } catch (error) {
      this.emit({
        type: "toast",
        toastType: "error",
        message: `GPA 自动续跑失败：${error instanceof Error ? error.message : String(error)}`,
      });
    } finally {
      this.gpaAutoContinuing = false;
    }
  }

  private resetGpaRuntime(): void {
    this.gpaState = createDefaultGpaState();
    this.gpaAutoContinueDone = 0;
    this.gpaAutoContinueStreak = 0;
    this.gpaAutoContinuing = false;
    this.gpaSkipNextAutoContinue = false;
    this.gpaPlanBody = "";
  }

  private currentSessionId(): string {
    return this.runtime?.session?.sessionId ?? "";
  }

  private gpaPlanFileStatus(): GpaPlanFileStatus {
    if (this.gpaState.stage === "plan") return "awaiting_confirmation";
    if (this.gpaState.stage === "act") {
      return this.gpaState.planTasks.length > 0 && this.gpaState.planTasks.every((task) => task.done)
        ? "completed"
        : "in_progress";
    }
    if (this.gpaState.planTasks.some((task) => !task.done)) return "in_progress";
    return "in_progress";
  }

  private gpaResumePreview(): GpaPlanResumePreview | null {
    if (this.gpaState.planTasks.length === 0) return null;
    if (this.gpaState.stage === "off") return null;
    const pendingTasks = this.gpaState.planTasks.filter((task) => !task.done);
    return {
      status: this.gpaPlanFileStatus(),
      sourceThreadId: this.currentSessionId(),
      currentThreadId: this.currentSessionId(),
      sameSession: true,
      updatedAt: this.gpaState.updatedAt,
      tasks: this.gpaState.planTasks,
      body: this.gpaPlanBody,
      doneCount: this.gpaState.planTasks.length - pendingTasks.length,
      pendingCount: pendingTasks.length,
      pendingTasks,
    };
  }

  private async persistGpaPlanFile(
    status: GpaPlanFileStatus,
    tasks = this.gpaState.planTasks,
    body = this.gpaPlanBody,
  ): Promise<void> {
    if (!this.cwd || tasks.length === 0) return;
    try {
      let nextBody = body;
      if (!nextBody) {
        const existing = await readGpaPlanFile(this.cwd);
        nextBody = existing?.body ?? "";
      }
      await writeGpaPlanFile(this.cwd, {
        status,
        threadId: this.currentSessionId(),
        updatedAt: new Date().toISOString(),
        tasks,
        body: nextBody,
      });
    } catch (error) {
      this.emit({
        type: "toast",
        toastType: "warning",
        message: `写入 GPA 计划文件失败：${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  private async readGpaResumePreview(): Promise<GpaPlanResumePreview | null> {
    if (!this.cwd) return null;
    try {
      const existing = await readGpaPlanFile(this.cwd);
      if (!gpaPlanHasIncompleteTasks(existing) || !existing) return null;
      return toGpaPlanResumePreview(existing, this.currentSessionId());
    } catch {
      return null;
    }
  }

  private async tryRestoreGpaPlanFromFile(): Promise<boolean> {
    if (!this.cwd) return false;
    const existing = await readGpaPlanFile(this.cwd);
    if (!gpaPlanHasIncompleteTasks(existing) || !existing) return false;
    if (existing.body.trim()) this.gpaPlanBody = existing.body;
    if (existing.status === "awaiting_confirmation") {
      this.gpaState = {
        ...this.gpaState,
        stage: "plan",
        awaitingConfirmation: "plan",
        planTasks: existing.tasks,
        updatedAt: new Date().toISOString(),
      };
    } else {
      this.gpaState = {
        ...this.gpaState,
        stage: "act",
        awaitingConfirmation: null,
        planTasks: existing.tasks,
        updatedAt: new Date().toISOString(),
      };
      this.gpaAutoContinueDone = existing.tasks.filter((task) => task.done).length;
      this.gpaAutoContinueStreak = 0;
    }
    await this.persistGpaPlanFile(
      this.gpaState.stage === "plan" ? "awaiting_confirmation" : "in_progress",
      this.gpaState.planTasks,
    );
    return true;
  }

  /** 打开项目/切换会话时只恢复时间线，不自动开跑。 */
  private async softRestoreGpaPlanFromFile(): Promise<void> {
    const restored = await this.tryRestoreGpaPlanFromFile();
    if (!restored) return;
    const pending = this.gpaState.planTasks.filter((task) => !task.done).length;
    this.emit({
      type: "toast",
      toastType: "info",
      message:
        this.gpaState.stage === "plan"
          ? "已恢复未确认的 GPA 计划，确认后即可继续执行。"
          : `已恢复未完成的 GPA 计划，剩余 ${pending} 项。点击「继续执行」接着做。`,
    });
    this.pushSnapshot();
  }

  private async abandonGpaPlanFile(): Promise<boolean> {
    if (!this.cwd) return false;
    try {
      const existing = await readGpaPlanFile(this.cwd);
      if (!existing || existing.status === "completed" || existing.status === "abandoned") return false;
      await writeGpaPlanFile(this.cwd, {
        status: "abandoned",
        threadId: existing.threadId || this.currentSessionId(),
        updatedAt: new Date().toISOString(),
        tasks: existing.tasks,
        body: existing.body,
      });
      return true;
    } catch (error) {
      this.emit({
        type: "toast",
        toastType: "warning",
        message: `废弃 GPA 计划失败：${error instanceof Error ? error.message : String(error)}`,
      });
      return false;
    }
  }

  async navigateTree(targetId: string, summarize = false): Promise<SessionSnapshot> {
    await this.requireSession().navigateTree(targetId, { summarize });
    this.pushSnapshot();
    const snapshot = this.snapshot();
    if (!snapshot) throw new Error("导航会话树失败");
    return snapshot;
  }

  getTree(path?: string): TreeNode[] {
    const currentFile = this.runtime?.session?.sessionFile;
    if (path && path !== currentFile) {
      return serializeTree(SessionManager.open(path).getTree());
    }
    const session = this.runtime?.session;
    if (!session) return [];
    return serializeTree(session.sessionManager.getTree());
  }

  async compact(instructions?: string): Promise<void> {
    await this.requireSession().compact(instructions);
    this.pushSnapshot();
  }

  async reload(): Promise<void> {
    await this.requireSession().reload();
    await this.attachSession();
  }

  async listModels(): Promise<{ models: ModelOption[]; providers: ProviderOption[] }> {
    const runtime = this.requireModels();
    await this.migrateModelReasoningFlags();
    await runtime.refresh({ allowNetwork: false });
    const available = new Set(
      (await runtime.getAvailable().catch(() => runtime.getAvailableSnapshot())).map(
        (model) => `${model.provider}/${model.id}`,
      ),
    );
    const models: ModelOption[] = runtime.getModels().map((model) => {
      const custom = this.customModelConfig(model.provider, model.id);
      return {
        provider: model.provider,
        id: model.id,
        name: model.name ?? model.id,
        contextWindow: model.contextWindow,
        maxTokens: model.maxTokens,
        reasoning: Boolean(model.reasoning || custom?.reasoning || (custom?.thinkingLevels?.length ?? 0) > 0),
        available: available.has(`${model.provider}/${model.id}`) || runtime.hasConfiguredAuth(model.provider),
        thinkingLevels: this.thinkingLevelsForModel(model.provider, model.id, model.reasoning),
        defaultThinkingLevel: this.preferredThinkingLevel(model.provider, model.id),
      };
    });
    const customIds = new Set(Object.keys(this.getModelsFile().file.providers ?? {}));
    const providers: ProviderOption[] = runtime.getProviders().map((provider) => {
      const auth = provider.auth as { apiKey?: unknown; oauth?: unknown } | undefined;
      const status = runtime.getProviderAuthStatus(provider.id);
      return {
        id: provider.id,
        name: ("name" in provider && typeof provider.name === "string" ? provider.name : provider.id),
        authConfigured: runtime.hasConfiguredAuth(provider.id),
        authSource: status.configured ? status.source : undefined,
        isCustom: customIds.has(provider.id),
        supportsApiKey: Boolean(auth?.apiKey) || customIds.has(provider.id),
        supportsOAuth: Boolean(auth?.oauth),
      };
    });
    return { models, providers };
  }

  async setModel(provider: string, id: string): Promise<void> {
    await this.ensureModelReasoning(provider, id);
    const model = this.requireModels().getModel(provider, id);
    if (!model) throw new Error(`找不到模型 ${provider}/${id}`);
    await this.requireSession().setModel(model);
    // 对话窗口切换模型后，优先用该模型配置的默认思考等级，否则用全局默认；必须落在该模型勾选的档位里。
    const allowed = this.thinkingLevelsForModel(provider, id, model.reasoning);
    const preferred = this.preferredThinkingLevel(provider, id);
    const next = preferred && allowed.includes(preferred) ? preferred : allowed[0];
    if (next) this.requireSession().setThinkingLevel(next);
    this.runtime?.services.settingsManager.setDefaultModelAndProvider(provider, id);
    this.pushSnapshot();
  }

  async setThinkingLevel(level: ThinkingLevel): Promise<void> {
    const session = this.requireSession();
    const model = session.model;
    if (model) await this.ensureModelReasoning(model.provider, model.id);
    const live = this.requireSession();
    const allowed = model
      ? this.thinkingLevelsForModel(model.provider, model.id, model.reasoning)
      : ["off"];
    live.setThinkingLevel(allowed.includes(level) ? level : (allowed[0] ?? "off"));
    if (model) {
      this.runtime?.services.settingsManager.setModelThinkingLevel(model.provider, model.id, live.thinkingLevel);
    }
    this.pushSnapshot();
  }

  getModelsFile(): { path: string; file: ModelsFile; raw: string; error?: string } {
    const path = this.modelsPath();
    return { path, ...readModelsFile(path) };
  }

  async saveModelsFile(file: ModelsFile): Promise<void> {
    const { file: next } = applySafeCustomOpenAiCompat(file);
    writeModelsFile(this.modelsPath(), next);
    await this.requireModels().refresh({ allowNetwork: false });
  }

  async refreshModels(): Promise<void> {
    await this.requireModels().refresh({ allowNetwork: true });
  }

  async login(providerId: string, type: AuthType): Promise<void> {
    const runtime = this.requireModels();
    await runtime.login(providerId, type, {
      prompt: async (prompt: AuthPrompt) => {
        if (prompt.type === "select") {
          const request: Omit<DialogRequest, "id"> = {
            kind: "select",
            title: prompt.message,
            options: prompt.options.map((option) => ({
              id: option.id,
              label: option.label,
              description: option.description,
            })),
          };
          const selected = await this.dialogs.ask(request);
          if (typeof selected !== "string") throw new Error("已取消登录");
          return selected;
        }
        const kind = prompt.type === "secret" ? "secret" : prompt.type === "manual_code" ? "manual_code" : "input";
        const value = await this.dialogs.input(prompt.message, prompt.placeholder, kind);
        if (!value) throw new Error("已取消登录");
        return value;
      },
      notify: (event: AuthEvent) => {
        if (event.type === "auth_url") {
          void shell.openExternal(event.url);
          this.emit({ type: "toast", toastType: "info", message: event.instructions ?? `请在浏览器完成登录: ${event.url}` });
          return;
        }
        if (event.type === "device_code") {
          void shell.openExternal(event.verificationUri);
          this.emit({
            type: "toast",
            toastType: "info",
            message: `设备码 ${event.userCode}，已打开 ${event.verificationUri}`,
          });
          return;
        }
        if (event.type === "info") {
          this.emit({ type: "toast", toastType: "info", message: event.message });
        }
      },
    });
  }

  async logout(providerId: string): Promise<void> {
    await this.requireModels().logout(providerId);
  }

  async setApiKey(providerId: string, apiKey: string): Promise<void> {
    await this.requireModels().setRuntimeApiKey(providerId, apiKey);
  }

  getSettings(): DesktopSettings {
    const settings = this.runtime?.services.settingsManager;
    return {
      defaultProvider: settings?.getDefaultProvider(),
      defaultModel: settings?.getDefaultModel(),
      defaultThinkingLevel: settings?.getDefaultThinkingLevel(),
      hideThinkingBlock: settings?.getHideThinkingBlock(),
      compactionEnabled: settings?.getCompactionEnabled(),
      retryEnabled: settings?.getRetryEnabled(),
      steeringMode: settings?.getSteeringMode(),
      followUpMode: settings?.getFollowUpMode(),
      defaultProjectTrust: settings?.getDefaultProjectTrust(),
      theme: settings?.getTheme(),
    };
  }

  updateSettings(patch: DesktopSettings): void {
    const settings = this.requireRuntime().services.settingsManager;
    if (patch.defaultProvider && patch.defaultModel) {
      settings.setDefaultModelAndProvider(patch.defaultProvider, patch.defaultModel);
    } else if (patch.defaultProvider) {
      settings.setDefaultProvider(patch.defaultProvider);
    } else if (patch.defaultModel) {
      settings.setDefaultModel(patch.defaultModel);
    }
    if (patch.defaultThinkingLevel) {
      settings.setDefaultThinkingLevel(patch.defaultThinkingLevel);
      this.runtime?.session?.setThinkingLevel(patch.defaultThinkingLevel);
      this.pushSnapshot();
    }
    if (patch.hideThinkingBlock !== undefined) settings.setHideThinkingBlock(patch.hideThinkingBlock);
    if (patch.compactionEnabled !== undefined) settings.setCompactionEnabled(patch.compactionEnabled);
    if (patch.retryEnabled !== undefined) settings.setRetryEnabled(patch.retryEnabled);
    if (patch.steeringMode) settings.setSteeringMode(patch.steeringMode);
    if (patch.followUpMode) settings.setFollowUpMode(patch.followUpMode);
    if (patch.defaultProjectTrust) settings.setDefaultProjectTrust(patch.defaultProjectTrust);
    if (patch.theme) settings.setTheme(patch.theme);
  }

  setFullTrust(enabled: boolean): boolean {
    const cwd = this.runtime?.cwd ?? this.cwd;
    this.permissionStore.setFullTrust(cwd, enabled);
    if (enabled) this.dialogs.approvePendingPermissions();
    this.pushSnapshot();
    return enabled;
  }

  isFullTrust(): boolean {
    return this.permissionStore.isFullTrust(this.runtime?.cwd ?? this.cwd);
  }

  trustProject(trusted: boolean, includeParent = false): void {
    const cwd = this.requireRuntime().cwd;
    const store = new ProjectTrustStore(getAgentDir());
    if (includeParent) {
      store.set(dirname(cwd), true);
    } else {
      store.set(cwd, trusted);
    }
    this.requireRuntime().services.settingsManager.setProjectTrusted(trusted);
  }

  async exportHtml(outputPath?: string): Promise<string> {
    return this.requireSession().exportToHtml(outputPath);
  }

  exportJsonl(outputPath?: string): string {
    return this.requireSession().exportToJsonl(outputPath);
  }

  async importJsonl(inputPath: string): Promise<SessionSnapshot> {
    const result = await this.requireRuntime().importFromJsonl(inputPath, this.cwd);
    if (result.cancelled) throw new Error("导入被取消");
    await this.attachSession();
    const snapshot = this.snapshot();
    if (!snapshot) throw new Error("导入失败");
    return snapshot;
  }

  copySessionFile(destination: string): string {
    const file = this.requireSession().sessionFile;
    if (!file || !existsSync(file)) throw new Error("当前会话尚未落盘");
    copyFileSync(file, destination);
    return destination;
  }

  searchFiles(query: string) {
    return searchProjectFiles(this.runtime?.cwd ?? this.cwd, query);
  }

  getCommands(): SlashCommand[] {
    const builtins = BUILTIN_SLASH_COMMANDS;
    const session = this.runtime?.session;
    if (!session) return builtins;
    const templates: SlashCommand[] = session.promptTemplates.map((template) => ({
      name: template.name,
      description: template.description,
      source: "prompt",
    }));
    const skills: SlashCommand[] = this.collectResources().skills.map((skill) => ({
      name: `skill:${skill.name}`,
      description: skill.description,
      source: "skill",
    }));
    const runner = session.extensionRunner as { getRegisteredCommands?: () => Array<{ invocationName: string; description?: string }> };
    const extensions: SlashCommand[] = (runner.getRegisteredCommands?.() ?? []).map((command) => ({
      name: command.invocationName,
      description: command.description,
      source: "extension",
    }));
    return [...builtins, ...templates, ...skills, ...extensions];
  }

  getSessionInfo(): Record<string, unknown> {
    return this.requireSession().getSessionStats();
  }

  private packageContext() {
    const cwd = this.runtime?.cwd ?? this.cwd;
    return createPackageContext(cwd, this.runtime?.services.settingsManager);
  }

  private bindPackageProgress(): ReturnType<typeof createPackageContext> {
    const ctx = this.packageContext();
    ctx.pm.setProgressCallback((event) => {
      if (!event.message) return;
      this.emit({
        type: "toast",
        toastType: event.type === "error" ? "error" : "info",
        message: event.message,
      });
    });
    return ctx;
  }

  private async afterPackageChange(ctx: PackageContext): Promise<PackageInventory> {
    await ctx.settingsManager.flush();
    if (this.runtime) {
      if (ctx.settingsManager !== this.runtime.services.settingsManager) {
        await this.runtime.services.settingsManager.reload();
      }
      await this.requireSession().reload();
      await this.attachSession();
    }
    return listInstalled(ctx);
  }

  async listCatalog(): Promise<{ packages: CatalogPackage[]; updatedAt?: number }> {
    const packages = await fetchPiPackages(false);
    return { packages, updatedAt: catalogUpdatedAt() };
  }

  async refreshCatalog(): Promise<{ packages: CatalogPackage[]; updatedAt?: number }> {
    const packages = await fetchPiPackages(true);
    return { packages, updatedAt: catalogUpdatedAt() };
  }

  async listPackages(): Promise<PackageInventory> {
    return listInstalled(this.packageContext());
  }

  async installPackage(name: string): Promise<PackageInventory> {
    const ctx = this.bindPackageProgress();
    await ctx.pm.installAndPersist(toNpmSource(name));
    return this.afterPackageChange(ctx);
  }

  async removePackage(source: string): Promise<PackageInventory> {
    const ctx = this.bindPackageProgress();
    await ctx.pm.removeAndPersist(toNpmSource(source));
    return this.afterPackageChange(ctx);
  }

  async toggleInstalledResource(item: InstalledResource, enabled: boolean): Promise<PackageInventory> {
    const ctx = this.packageContext();
    toggleResource(ctx, item, enabled);
    return this.afterPackageChange(ctx);
  }

  async importSkill(sourcePath: string): Promise<PackageInventory> {
    const ctx = this.packageContext();
    importLocalSkill(sourcePath);
    return this.afterPackageChange(ctx);
  }

  async dispose(): Promise<void> {
    this.stopWatchdog();
    this.unsubscribe?.();
    if (this.runtime) {
      await this.runtime.dispose();
      this.runtime = undefined;
    }
  }

  private lastUserText(): string {
    const messages = this.runtime ? collectDisplayMessages(this.runtime.session) : [];
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index]?.role !== "user") continue;
      const content = messages[index].content;
      if (typeof content === "string") return content;
      if (!Array.isArray(content)) continue;
      return content.map((part) => (part.type === "text" ? String(part.text ?? "") : "")).join("").trim();
    }
    return "";
  }

  private gpaBrief(): string {
    const gpa = this.gpaState;
    if (!gpa || gpa.stage === "off") return "未启用";
    const done = gpa.planTasks.filter((task) => task.done).length;
    return `${gpa.stage} ${done}/${gpa.planTasks.length}`;
  }

  private startWatchdogIfNeeded(): void {
    if (this.watchdogIdleTimer) {
      clearTimeout(this.watchdogIdleTimer);
      this.watchdogIdleTimer = undefined;
    }
    if (this.watchdogTimer) return;
    this.watchdogRound = 0;
    this.watchdogTurnStartedAt = Date.now();
    this.recentToolLog = [];
    this.watchdogTimer = setInterval(() => {
      void this.runWatchdog();
    }, WATCHDOG_INTERVAL_MS);
  }

  private armWatchdogIdleStop(): void {
    if (this.watchdogIdleTimer) clearTimeout(this.watchdogIdleTimer);
    this.watchdogIdleTimer = setTimeout(() => {
      this.watchdogIdleTimer = undefined;
      const session = this.runtime?.session;
      if (session?.isStreaming || session?.isCompacting) return;
      this.stopWatchdog();
    }, 1500);
  }

  private stopWatchdog(): void {
    if (this.watchdogIdleTimer) {
      clearTimeout(this.watchdogIdleTimer);
      this.watchdogIdleTimer = undefined;
    }
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = undefined;
    }
    this.watchdogAbort?.abort();
    this.watchdogAbort = undefined;
  }

  private upsertWatchdogReport(report: WatchdogReport): void {
    const index = this.watchdogReports.findIndex((item) => item.id === report.id);
    if (index >= 0) this.watchdogReports[index] = report;
    else this.watchdogReports = [...this.watchdogReports, report].slice(-20);
    this.emit({ type: "watchdog", watchdog: report });
    this.pushSnapshot();
  }

  private async runWatchdog(): Promise<void> {
    const session = this.runtime?.session;
    const model = session?.model;
    if (!session || !model) return;
    if (!(session.isStreaming || session.isCompacting)) return;
    this.watchdogAbort?.abort();
    const abort = new AbortController();
    this.watchdogAbort = abort;
    this.watchdogRound += 1;
    const report: WatchdogReport = {
      id: `watchdog-${this.watchdogTurnStartedAt}-${this.watchdogRound}`,
      round: this.watchdogRound,
      elapsedMs: Date.now() - this.watchdogTurnStartedAt,
      status: "running",
      summary: "正在查询主代理执行情况…",
      startedAt: Date.now(),
    };
    this.upsertWatchdogReport(report);
    this.emit({
      type: "toast",
      toastType: "info",
      message: `任务已超过 ${Math.round(report.elapsedMs / 60000)} 分钟，正在启动子代理查看进度`,
    });
    try {
      const summary = await runWatchdogSubagent({
        cwd: this.runtime?.cwd ?? this.cwd,
        modelRuntime: this.requireModels(),
        provider: model.provider,
        modelId: model.id,
        signal: abort.signal,
        brief: {
          cwd: this.runtime?.cwd ?? this.cwd,
          elapsedMs: report.elapsedMs,
          round: this.watchdogRound,
          activity: this.activityLabel,
          lastUser: this.lastUserText(),
          gpa: this.gpaBrief(),
          recentTools: this.recentToolLog,
        },
      });
      if (abort.signal.aborted) return;
      this.upsertWatchdogReport({ ...report, status: "done", summary });
    } catch (error) {
      if (abort.signal.aborted) return;
      this.upsertWatchdogReport({
        ...report,
        status: "failed",
        summary: error instanceof Error ? error.message : String(error),
      });
    }
  }

  getResourceFiles(): ResourceFiles {
    const loader = this.runtime?.services.resourceLoader;
    if (!loader) return emptyResourceFiles();
    return {
      prompts: loader.getPrompts().prompts.map((prompt) =>
        toResourceFile({
          kind: "prompt",
          name: prompt.name,
          path: prompt.filePath,
          content: prompt.content,
          description: prompt.description,
          argumentHint: prompt.argumentHint,
          scope: prompt.sourceInfo?.scope,
        }),
      ),
      agentsFiles: loader.getAgentsFiles().agentsFiles.map((file) =>
        toResourceFile({
          kind: "agents",
          name: resourceFileName(file.path, "AGENTS.md"),
          path: file.path,
          content: file.content,
        }),
      ),
    };
  }

  async saveResourceFile(
    kind: ResourceFile["kind"],
    path: string,
    content: string,
    description?: string,
  ): Promise<ResourceFiles> {
    const current = this.getResourceFiles();
    const allowed = kind === "prompt" ? current.prompts : current.agentsFiles;
    if (!allowed.some((item) => samePath(item.path, path))) {
      throw new Error("只能修改当前已加载的模板或上下文文件");
    }
    if (kind === "prompt") writePromptTemplateFile(path, content, description);
    else writeAgentsContextFile(path, content);
    await this.reloadResourceFiles();
    return this.getResourceFiles();
  }

  async createResourceFile(input: CreateResourceFileInput): Promise<ResourceFiles> {
    createResourceFileOnDisk({
      ...input,
      cwd: this.runtime?.cwd,
    });
    await this.reloadResourceFiles();
    return this.getResourceFiles();
  }

  private async reloadResourceFiles(): Promise<void> {
    const session = this.runtime?.session;
    if (session && !session.isStreaming && !session.isCompacting) {
      await session.reload();
      await this.attachSession();
    }
    this.pushSnapshot();
  }
}
