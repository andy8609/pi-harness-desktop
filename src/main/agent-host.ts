import { copyFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { shell } from "electron";
import type {
  CatalogPackage,
  DesktopSettings,
  DialogRequest,
  InstalledResource,
  ModelOption,
  ModelsFile,
  PackageInventory,
  PromptPayload,
  ProviderOption,
  ResourceSummary,
  SessionListItem,
  SessionSnapshot,
  SlashCommand,
  StreamEvent,
  ThinkingLevel,
  TreeNode,
} from "@shared/types";
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
import { searchProjectFiles } from "./file-search";
import { readModelsFile, writeModelsFile } from "./models-file";
import {
  createPackageContext,
  importLocalSkill,
  listInstalled,
  toggleResource,
  toNpmSource,
  type PackageContext,
} from "./package-ops";
import { buildSnapshot, collectDisplayMessages, serializeTree } from "./serialize";

type EventSink = (event: StreamEvent) => void;

export class AgentHost {
  private modelRuntime: ModelRuntime | undefined;
  private runtime: AgentSessionRuntime | undefined;
  private unsubscribe: (() => void) | undefined;
  private queue = { steering: [] as string[], followUp: [] as string[] };
  private cwd = homedir();
  private activityLabel = "";
  private activityStartedAt = 0;
  private activityTimer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly dialogs: DialogBroker,
    private readonly emit: EventSink,
  ) {}

  async initialize(): Promise<void> {
    this.modelRuntime = await ModelRuntime.create({
      allowModelNetwork: true,
      refreshOnCreate: true,
    });
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
      messages: collectDisplayMessages(session),
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
      resources: this.collectResources(),
      diagnostics: [...runtime.diagnostics],
      modelFallbackMessage: runtime.modelFallbackMessage,
      projectTrusted: runtime.services.settingsManager.isProjectTrusted(),
      queue: this.queue,
      contextUsage: session.getContextUsage(),
    });
  }

  private pushSnapshot(): void {
    const snapshot = this.snapshot();
    if (snapshot) this.emit({ type: "snapshot", snapshot });
  }

  private setActivity(message: string): void {
    const now = Date.now();
    if (!this.activityStartedAt) this.activityStartedAt = now;
    this.activityLabel = message;
    this.emit({
      type: "activity",
      message,
      elapsed: now - this.activityStartedAt,
    });
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
      return;
    }
    if (event.type === "message_start") {
      const role = (event.message as { role?: string } | undefined)?.role;
      if (role === "user") this.setActivity("已收到消息，正在思考…");
      else if (role === "assistant") this.setActivity("模型正在回复…");
      return;
    }
    if (event.type === "message_update") {
      const assistantEvent = event.assistantMessageEvent as { type?: string; delta?: string } | undefined;
      if (assistantEvent?.type === "text_delta" && assistantEvent.delta) {
        this.setActivity("正在输出回复…");
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
      this.clearActivity();
      this.pushSnapshot();
      return;
    }
    if (event.type === "message_end" || event.type === "session_info_changed" || event.type === "thinking_level_changed") {
      this.pushSnapshot();
    }
  }

  private createFactory(): CreateAgentSessionRuntimeFactory {
    return async ({ cwd, sessionManager, sessionStartEvent, projectTrustContext }) => {
      void projectTrustContext;
      const services = await createAgentSessionServices({
        cwd,
        modelRuntime: this.requireModels(),
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
    const snapshot = this.snapshot();
    if (!snapshot) throw new Error("打开项目失败");
    return snapshot;
  }

  async prompt(payload: PromptPayload): Promise<void> {
    const session = this.requireSession();
    const text = payload.text;
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
    await new Promise<void>((resolve, reject) => {
      let accepted = false;
      const streamingBehavior = session.isStreaming ? payload.streamingBehavior ?? "steer" : undefined;
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
    await this.requireSession().abort();
    this.clearActivity();
    this.pushSnapshot();
  }

  async steer(text: string): Promise<void> {
    await this.requireSession().steer(text);
  }

  async followUp(text: string): Promise<void> {
    await this.requireSession().followUp(text);
  }

  async newSession(): Promise<SessionSnapshot> {
    const result = await this.requireRuntime().newSession();
    if (result.cancelled) throw new Error("新建会话被取消");
    await this.attachSession();
    const snapshot = this.snapshot();
    if (!snapshot) throw new Error("新建会话失败");
    return snapshot;
  }

  async switchSession(path: string): Promise<SessionSnapshot> {
    const result = await this.requireRuntime().switchSession(path);
    if (result.cancelled) throw new Error("切换会话被取消");
    await this.attachSession();
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
    await runtime.refresh({ allowNetwork: false });
    const available = new Set(
      (await runtime.getAvailable().catch(() => runtime.getAvailableSnapshot())).map(
        (model) => `${model.provider}/${model.id}`,
      ),
    );
    const models: ModelOption[] = runtime.getModels().map((model) => ({
      provider: model.provider,
      id: model.id,
      name: model.name ?? model.id,
      contextWindow: model.contextWindow,
      maxTokens: model.maxTokens,
      reasoning: model.reasoning,
      available: available.has(`${model.provider}/${model.id}`) || runtime.hasConfiguredAuth(model.provider),
    }));
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
    const model = this.requireModels().getModel(provider, id);
    if (!model) throw new Error(`找不到模型 ${provider}/${id}`);
    await this.requireSession().setModel(model);
    this.runtime?.services.settingsManager.setDefaultModelAndProvider(provider, id);
    this.pushSnapshot();
  }

  setThinkingLevel(level: ThinkingLevel): void {
    this.requireSession().setThinkingLevel(level);
    this.runtime?.services.settingsManager.setDefaultThinkingLevel(level);
    this.pushSnapshot();
  }

  getModelsFile(): { path: string; file: ModelsFile; raw: string; error?: string } {
    const path = this.modelsPath();
    return { path, ...readModelsFile(path) };
  }

  async saveModelsFile(file: ModelsFile): Promise<void> {
    writeModelsFile(this.modelsPath(), file);
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
    if (patch.defaultThinkingLevel) settings.setDefaultThinkingLevel(patch.defaultThinkingLevel);
    if (patch.hideThinkingBlock !== undefined) settings.setHideThinkingBlock(patch.hideThinkingBlock);
    if (patch.compactionEnabled !== undefined) settings.setCompactionEnabled(patch.compactionEnabled);
    if (patch.retryEnabled !== undefined) settings.setRetryEnabled(patch.retryEnabled);
    if (patch.steeringMode) settings.setSteeringMode(patch.steeringMode);
    if (patch.followUpMode) settings.setFollowUpMode(patch.followUpMode);
    if (patch.defaultProjectTrust) settings.setDefaultProjectTrust(patch.defaultProjectTrust);
    if (patch.theme) settings.setTheme(patch.theme);
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
    this.unsubscribe?.();
    if (this.runtime) {
      await this.runtime.dispose();
      this.runtime = undefined;
    }
  }
}
