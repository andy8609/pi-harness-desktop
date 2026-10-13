import { copyFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { shell } from "electron";
import { applyCompletedPlanTasks, buildGpaContinuePrompt, buildGpaResumePrompt, createDefaultGpaState, detectGpaConfirmation, normalizeSequentialPlanTasks, parseCanonicalGpaPlanTasks, parseGpaCheckboxCompletions, parseGpaCompletedTaskDeclarations, parseGpaPlanTasks, liveReconcileGpaPlanTasks, } from "@shared/gpa";
import { gpaPlanHasIncompleteTasks, toGpaPlanResumePreview, } from "@shared/gpa-plan-file";
import { readGpaPlanFile, writeGpaPlanFile } from "./gpa-plan-io";
import { ModelRuntime, ProjectTrustStore, SessionManager, createAgentSessionFromServices, createAgentSessionRuntime, createAgentSessionServices, getAgentDir, hasTrustRequiringProjectResources, } from "@earendil-works/pi-coding-agent";
function contentToText(content) {
    if (typeof content === "string")
        return content;
    if (Array.isArray(content)) {
        return content
            .filter((part) => part.type === "text")
            .map((part) => String(part.text ?? ""))
            .join("");
    }
    return "";
}
/** 合法思考等级集合，用于校验 models.json 中配置的每模型默认思考等级。 */
const VALID_THINKING_LEVELS = new Set([
    "off",
    "minimal",
    "low",
    "medium",
    "high",
    "xhigh",
    "max",
]);
const BUILTIN_SLASH_COMMANDS = [
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
import { createPermissionExtension } from "./extensions/permissions";
import { PermissionStore } from "./permission-store";
import { createGpaExtension } from "./extensions/gpa";
import { searchProjectFiles } from "./file-search";
import { readModelsFile, writeModelsFile } from "./models-file";
import { createPackageContext, importLocalSkill, listInstalled, toggleResource, toNpmSource, } from "./package-ops";
import { buildSnapshot, collectDisplayMessages, serializeTree } from "./serialize";
export class AgentHost {
    dialogs;
    emit;
    modelRuntime;
    runtime;
    unsubscribe;
    queue = { steering: [], followUp: [] };
    /**
     * 队列消息的图片附件（文本 → 图片）：pi 的队列镜像只含文本，
     * 编辑/删除队列消息需要清空重建，重建时用它恢复附件。
     */
    queuedImages = new Map();
    /** 重建队列期间（clearQueue → 重新入队）暂停图片映射的清理，避免误删尚未重建的条目。 */
    restoringQueue = false;
    /** 队列操作（删除/编辑/转 steer）的串行执行链，避免并发重建互相覆盖。 */
    queueMutationChain = Promise.resolve();
    cwd = homedir();
    activityLabel = "";
    activityStartedAt = 0;
    activityTimer;
    gpaState = createDefaultGpaState();
    /**
     * GPA ACT 自动续跑基线：上次自动续跑时的已完成任务数。
     * 与 workagent 一致：ACT 未完成时默认续跑，不因「更新计划」而停下来等用户输入继续。
     */
    gpaAutoContinueDone = 0;
    /** 连续无进展续跑次数。超过上限才停，避免模型空转。 */
    gpaAutoContinueStreak = 0;
    gpaAutoContinuing = false;
    /** 用户中止后跳过下一次自动续跑，避免立刻又被拉起来。 */
    gpaSkipNextAutoContinue = false;
    /** 最近一次 PLAN 正文，写入 .codexh/gpa-plan.md 供关闭后恢复。 */
    gpaPlanBody = "";
    /** 当前助手消息的流式正文，供 Updated Plan 实时解析。 */
    streamingAssistantText = "";
    gpaLiveTimer;
    permissionStore = new PermissionStore();
    static MAX_GPA_NO_PROGRESS_CONTINUES = 2;
    static GPA_LIVE_UPDATE_MS = 120;
    constructor(dialogs, emit) {
        this.dialogs = dialogs;
        this.emit = emit;
    }
    async initialize() {
        this.modelRuntime = await ModelRuntime.create({
            allowModelNetwork: true,
            refreshOnCreate: true,
        });
    }
    isBusy() {
        const session = this.runtime?.session;
        return Boolean(session?.isStreaming || session?.isCompacting || this.activityTimer);
    }
    pushUiSnapshot() {
        this.pushSnapshot();
    }
    getCwd() {
        return this.cwd;
    }
    requireRuntime() {
        if (!this.runtime) {
            throw new Error("请先打开一个项目目录");
        }
        return this.runtime;
    }
    requireSession() {
        return this.requireRuntime().session;
    }
    requireModels() {
        if (!this.modelRuntime) {
            throw new Error("模型运行时尚未初始化");
        }
        return this.modelRuntime;
    }
    modelsPath() {
        return join(getAgentDir(), "models.json");
    }
    customModelConfig(provider, id) {
        return this.getModelsFile().file.providers?.[provider]?.models?.find((entry) => entry.id === id);
    }
    preferredThinkingLevel(provider, id) {
        const custom = this.customModelConfig(provider, id)?.defaultThinkingLevel;
        if (custom && VALID_THINKING_LEVELS.has(custom))
            return custom;
        const perModel = this.runtime?.services.settingsManager.getModelThinkingLevel(provider, id);
        if (perModel && VALID_THINKING_LEVELS.has(perModel))
            return perModel;
        const global = this.runtime?.services.settingsManager.getDefaultThinkingLevel();
        if (global && VALID_THINKING_LEVELS.has(global))
            return global;
        return undefined;
    }
    thinkingLevelsForModel(provider, id, reasoning) {
        const custom = this.customModelConfig(provider, id);
        const configured = (custom?.thinkingLevels ?? []).filter((level) => VALID_THINKING_LEVELS.has(level));
        if (configured.length > 0) {
            return configured.includes("off") ? configured : ["off", ...configured];
        }
        return reasoning || custom?.reasoning
            ? ["off", "minimal", "low", "medium", "high"]
            : ["off"];
    }
    thinkingLevelsForCurrentModel() {
        const session = this.runtime?.session;
        const model = session?.model;
        if (!model)
            return ["off"];
        const fromSession = session.getAvailableThinkingLevels?.();
        const configured = this.thinkingLevelsForModel(model.provider, model.id, model.reasoning);
        if (fromSession && fromSession.length > 0) {
            const allowed = new Set(configured);
            const intersected = fromSession.filter((level) => allowed.has(level));
            return intersected.length > 0 ? intersected : fromSession;
        }
        return configured;
    }
    /** models.json 里勾选了思考等级但没写 reasoning 时，补上以便 SDK 真正接受思考等级。 */
    async migrateModelReasoningFlags() {
        const { file } = this.getModelsFile();
        let changed = false;
        for (const provider of Object.values(file.providers ?? {})) {
            for (const model of provider.models ?? []) {
                const wantsReasoning = Boolean(model.reasoning) ||
                    (model.thinkingLevels?.length ?? 0) > 0 ||
                    Boolean(model.defaultThinkingLevel);
                if (wantsReasoning && !model.reasoning) {
                    model.reasoning = true;
                    changed = true;
                }
            }
        }
        if (!changed)
            return;
        writeModelsFile(this.modelsPath(), file);
        await this.requireModels().refresh({ allowNetwork: false });
    }
    async ensureModelReasoning(provider, id) {
        await this.migrateModelReasoningFlags();
        const session = this.runtime?.session;
        const current = session?.model;
        if (!current || current.provider !== provider || current.id !== id)
            return;
        if (current.reasoning)
            return;
        const fresh = this.requireModels().getModel(provider, id);
        if (fresh?.reasoning) {
            await session.setModel(fresh);
        }
    }
    async resolveTrust(cwd, extensionsResult) {
        if (!hasTrustRequiringProjectResources(cwd))
            return true;
        const store = new ProjectTrustStore(getAgentDir());
        const existing = store.get(cwd);
        if (existing !== null)
            return existing;
        const parent = dirname(cwd);
        const options = ["信任此文件夹", "不信任项目级配置"];
        if (parent !== cwd)
            options.splice(1, 0, `同时信任父目录 (${parent})`);
        const selected = await this.dialogs.select(`是否信任项目文件夹？\n${cwd}\n\n信任后会加载项目内的 .pi 设置、扩展、Skills，并允许安装项目包。`, options);
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
    collectResources() {
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
    snapshot() {
        const runtime = this.runtime;
        if (!runtime)
            return undefined;
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
            availableThinkingLevels: this.thinkingLevelsForCurrentModel(),
            resources: this.collectResources(),
            diagnostics: [...runtime.diagnostics],
            modelFallbackMessage: runtime.modelFallbackMessage,
            projectTrusted: runtime.services.settingsManager.isProjectTrusted(),
            queue: this.queue,
            contextUsage: session.getContextUsage(),
            gpa: this.gpaState,
            gpaPlanResume: this.gpaResumePreview(),
        });
    }
    pushSnapshot() {
        const snapshot = this.snapshot();
        if (snapshot)
            this.emit({ type: "snapshot", snapshot });
    }
    setActivity(message) {
        const now = Date.now();
        if (!this.activityStartedAt)
            this.activityStartedAt = now;
        const unchanged = this.activityLabel === message && Boolean(this.activityTimer);
        this.activityLabel = message;
        if (!unchanged) {
            this.emit({
                type: "activity",
                message,
                elapsed: now - this.activityStartedAt,
            });
        }
        if (this.activityTimer)
            return;
        this.activityTimer = setInterval(() => {
            if (!this.activityStartedAt)
                return;
            this.emit({
                type: "activity",
                message: this.activityLabel || "仍在处理",
                elapsed: Date.now() - this.activityStartedAt,
            });
        }, 4000);
    }
    clearActivity() {
        if (this.activityTimer) {
            clearInterval(this.activityTimer);
            this.activityTimer = undefined;
        }
        this.activityStartedAt = 0;
        this.activityLabel = "";
        this.emit({ type: "activity", message: "", elapsed: 0 });
    }
    extensionUi() {
        return {
            select: async (title, options) => this.dialogs.select(title, options),
            confirm: async (title, message) => this.dialogs.confirm(title, message),
            input: async (title, placeholder) => this.dialogs.input(title, placeholder),
            notify: (message, type = "info") => {
                this.emit({ type: "toast", toastType: type, message });
            },
            onTerminalInput: () => () => undefined,
            setStatus: () => undefined,
            setWorkingMessage: (message) => {
                if (message)
                    this.setActivity(message);
            },
            setWorkingVisible: (visible) => {
                if (visible === false)
                    this.clearActivity();
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
    async attachSession() {
        this.unsubscribe?.();
        const session = this.requireSession();
        await session.bindExtensions({
            uiContext: this.extensionUi(),
            mode: "tui",
            onError: (error) => {
                this.emit({
                    type: "toast",
                    toastType: "error",
                    message: `扩展错误 ${error.extensionPath ?? ""}: ${error.error ?? "unknown"}`,
                });
            },
        });
        this.unsubscribe = session.subscribe((event) => {
            this.handleSessionEvent(event);
        });
        this.pushSnapshot();
    }
    handleSessionEvent(event) {
        if (event.type === "agent_start") {
            this.setActivity("正在连接模型…");
            return;
        }
        if (event.type === "message_start") {
            const role = event.message?.role;
            if (role === "user")
                this.setActivity("已收到消息，正在思考…");
            else if (role === "assistant") {
                this.streamingAssistantText = "";
                this.setActivity("模型正在回复…");
            }
            return;
        }
        if (event.type === "message_update") {
            const assistantEvent = event.assistantMessageEvent;
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
                steering: [...(event.steering ?? [])],
                followUp: [...(event.followUp ?? [])],
            };
            // 消息被消费（离开队列）后清理其图片映射；重建期间跳过，避免误删尚未重建的条目
            if (!this.restoringQueue)
                this.pruneQueuedImages();
            this.emit({ type: "queue_update", steering: this.queue.steering, followUp: this.queue.followUp });
            return;
        }
        if (event.type === "compaction_start") {
            this.setActivity("正在压缩上下文…");
            this.emit({ type: "compaction", reason: String(event.reason ?? event.type), message: event.errorMessage });
            this.pushSnapshot();
            return;
        }
        if (event.type === "compaction_end") {
            this.setActivity(event.aborted ? "压缩已结束" : "压缩完成，继续回复…");
            this.emit({ type: "compaction", reason: String(event.reason ?? event.type), message: event.errorMessage });
            this.pushSnapshot();
            return;
        }
        if (event.type === "auto_retry_start") {
            this.setActivity(`请求失败，正在重试（${String(event.attempt ?? "")}/${String(event.maxAttempts ?? "")}）…`);
            return;
        }
        if (event.type === "agent_end") {
            if (event.willRetry)
                this.setActivity("准备重试…");
            this.pushSnapshot();
            return;
        }
        if (event.type === "agent_settled") {
            this.clearActivity();
            this.flushLiveGpaUpdate();
            this.updateGpaFromMessages();
            this.pushSnapshot();
            // ACT 阶段：任务有推进时自动发送下一条指令，避免每完成一项都要用户手动"继续"。
            // 延迟到当前事件循环之后，确保 settled 收尾流程结束再启动新的 run。
            setTimeout(() => void this.maybeAutoContinueGpa(), 0);
            return;
        }
        if (event.type === "message_end") {
            const message = event.message;
            if (message?.role === "assistant") {
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
    createFactory() {
        return async ({ cwd, sessionManager, sessionStartEvent, projectTrustContext }) => {
            void projectTrustContext;
            const services = await createAgentSessionServices({
                cwd,
                modelRuntime: this.requireModels(),
                resourceLoaderOptions: {
                    extensionFactories: [
                        createPermissionExtension(this.dialogs, this.permissionStore),
                        createGpaExtension(() => this.gpaState, this.dialogs),
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
            const result = {
                ...created,
                services,
                diagnostics: services.diagnostics,
            };
            return result;
        };
    }
    async openProject(cwd) {
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
        await this.softRestoreGpaPlanFromFile();
        const snapshot = this.snapshot();
        if (!snapshot)
            throw new Error("打开项目失败");
        return snapshot;
    }
    async prompt(payload) {
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
                }
                finally {
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
        await new Promise((resolve, reject) => {
            let accepted = false;
            void session
                .prompt(text, {
                images: payload.images,
                streamingBehavior,
                preflightResult: (success) => {
                    if (!success || accepted)
                        return;
                    accepted = true;
                    resolve();
                },
            })
                .then(() => {
                this.pushSnapshot();
                if (!accepted)
                    resolve();
            })
                .catch((error) => {
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
    async abort() {
        this.gpaSkipNextAutoContinue = true;
        await this.requireSession().abort();
        this.clearActivity();
        void this.persistGpaPlanFile(this.gpaPlanFileStatus());
        this.pushSnapshot();
    }
    async steer(text) {
        await this.requireSession().steer(text);
    }
    async followUp(text) {
        await this.requireSession().followUp(text);
    }
    /**
     * 修改待发送队列：删除单条、编辑文本、把 follow-up 转为 steer。
     * pi 不支持单条增删，实现为 clearQueue 后按剩余顺序重建（图片附件从映射恢复）。
     * 队列操作串行执行：并发的 clearQueue + 重建会互相覆盖导致消息丢失。
     */
    async mutateQueue(action) {
        const run = this.queueMutationChain.then(() => this.applyQueueMutation(action));
        this.queueMutationChain = run.catch(() => undefined);
        return run;
    }
    async applyQueueMutation(action) {
        const session = this.requireSession();
        this.restoringQueue = true;
        try {
            const current = session.clearQueue();
            const steering = [...current.steering];
            const followUp = [...current.followUp];
            if (action.type === "remove") {
                const index = steering.indexOf(action.text);
                if (index !== -1)
                    steering.splice(index, 1);
                else {
                    const fallback = followUp.indexOf(action.text);
                    if (fallback !== -1)
                        followUp.splice(fallback, 1);
                }
            }
            else if (action.type === "update") {
                const newText = (action.newText ?? "").trim();
                if (!newText)
                    throw new Error("队列消息内容不能为空");
                const index = steering.indexOf(action.text);
                if (index !== -1)
                    steering[index] = newText;
                else {
                    const fallback = followUp.indexOf(action.text);
                    if (fallback !== -1)
                        followUp[fallback] = newText;
                }
                // 图片映射随文本转移
                const images = this.queuedImages.get(action.text);
                if (images) {
                    this.queuedImages.delete(action.text);
                    this.queuedImages.set(newText, images);
                }
            }
            else if (action.type === "toSteer") {
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
        }
        finally {
            this.restoringQueue = false;
            this.pruneQueuedImages();
        }
    }
    /** 清理已不在队列中的消息的图片映射，避免陈旧数据累积。 */
    pruneQueuedImages() {
        const pending = new Set([...this.queue.steering, ...this.queue.followUp]);
        for (const key of [...this.queuedImages.keys()]) {
            if (!pending.has(key))
                this.queuedImages.delete(key);
        }
    }
    async newSession() {
        this.resetGpaRuntime();
        this.permissionStore.clearSession();
        const result = await this.requireRuntime().newSession();
        if (result.cancelled)
            throw new Error("新建会话被取消");
        await this.attachSession();
        const model = this.runtime?.session?.model;
        if (model) {
            await this.ensureModelReasoning(model.provider, model.id);
            const preferred = this.preferredThinkingLevel(model.provider, model.id);
            if (preferred)
                this.requireSession().setThinkingLevel(preferred);
        }
        await this.softRestoreGpaPlanFromFile();
        const snapshot = this.snapshot();
        if (!snapshot)
            throw new Error("新建会话失败");
        return snapshot;
    }
    async switchSession(path) {
        this.resetGpaRuntime();
        this.permissionStore.clearSession();
        const result = await this.requireRuntime().switchSession(path);
        if (result.cancelled)
            throw new Error("切换会话被取消");
        await this.attachSession();
        await this.softRestoreGpaPlanFromFile();
        const snapshot = this.snapshot();
        if (!snapshot)
            throw new Error("切换会话失败");
        return snapshot;
    }
    async listSessions() {
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
    nameSession(name) {
        this.requireSession().setSessionName(name);
        this.pushSnapshot();
    }
    async fork(entryId) {
        const result = await this.requireRuntime().fork(entryId, { position: "before" });
        if (result.cancelled)
            throw new Error("Fork 被取消");
        await this.attachSession();
        const snapshot = this.snapshot();
        if (!snapshot)
            throw new Error("Fork 失败");
        return snapshot;
    }
    async clone() {
        const leafId = this.requireSession().sessionManager.getLeafId();
        if (!leafId)
            throw new Error("当前会话还没有可复制的节点");
        const result = await this.requireRuntime().fork(leafId, { position: "at" });
        if (result.cancelled)
            throw new Error("Clone 被取消");
        await this.attachSession();
        const snapshot = this.snapshot();
        if (!snapshot)
            throw new Error("Clone 失败");
        return snapshot;
    }
    /**
     * Edit a persisted user message and resend it: fork the session to just
     * before that entry, then submit the new text as a fresh turn.
     */
    async editAndResend(entryId, payload) {
        const result = await this.requireRuntime().fork(entryId, { position: "before" });
        if (result.cancelled)
            throw new Error("编辑被取消");
        await this.attachSession();
        await this.prompt(payload);
    }
    getGpaState() {
        return this.gpaState;
    }
    async peekGpaPlan() {
        return this.readGpaResumePreview();
    }
    /**
     * GPA 开关。开启时若项目里有未完成计划，先询问是继续还是废弃后重来；
     * 关闭时把当前进度写回 .codexh/gpa-plan.md，下次可以接着执行。
     */
    async setGpaEnabled(enabled) {
        if (!enabled) {
            await this.persistGpaPlanFile(this.gpaPlanFileStatus());
            this.resetGpaRuntime();
            this.pushSnapshot();
            return this.gpaState;
        }
        const preview = await this.readGpaResumePreview();
        if (preview) {
            const choice = await this.dialogs.select(`发现未完成的 GPA 计划（已完成 ${preview.doneCount}/${preview.tasks.length}，剩余 ${preview.pendingCount} 项）`, ["继续执行剩余任务", "重新开始（废弃旧计划）"]);
            if (!choice) {
                this.pushSnapshot();
                return this.gpaState;
            }
            if (choice === "重新开始（废弃旧计划）") {
                await this.abandonGpaPlanFile();
            }
            else {
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
    async confirmGpa() {
        const stage = this.gpaState.stage;
        if (stage !== "goal" && stage !== "plan")
            return;
        this.advanceGpaStage();
        const message = stage === "goal"
            ? "[internal:gpa-confirm] Continue with the confirmed goal. Produce the PLAN task list and acceptance criteria. Every atomic task heading must use exactly `### T1: Task title`."
            : "[internal:gpa-confirm] The plan is confirmed. Enter ACT and implement the planned tasks in order. After each task, output `✅ 任务 {ID} 完成` and immediately continue the next unfinished task. Do not wait for the user to type 继续.";
        await this.prompt({ text: message });
    }
    async resumeGpaPlan() {
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
        if (this.gpaState.stage !== "act")
            return;
        const pending = this.gpaState.planTasks.filter((task) => !task.done);
        if (pending.length === 0)
            return;
        this.gpaSkipNextAutoContinue = false;
        this.gpaAutoContinueStreak = 0;
        await this.prompt({ text: buildGpaResumePrompt(pending.length) });
    }
    async resetGpa() {
        await this.abandonGpaPlanFile();
        this.resetGpaRuntime();
        this.pushSnapshot();
        return this.gpaState;
    }
    async abandonGpaPlan() {
        return this.resetGpa();
    }
    /** Move to the next stage without sending a message (used by text confirmation). */
    advanceGpaStage() {
        const stage = this.gpaState.stage;
        if (stage === "goal") {
            this.gpaState = {
                ...this.gpaState,
                stage: "plan",
                awaitingConfirmation: null,
                updatedAt: new Date().toISOString(),
            };
        }
        else if (stage === "plan") {
            const text = this.latestAssistantText();
            const canonical = parseCanonicalGpaPlanTasks(text);
            const tasks = canonical.length > 0 ? canonical : parseGpaPlanTasks(text);
            if (text.trim())
                this.gpaPlanBody = text;
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
    maybeAdvanceGpaOnConfirmation(text) {
        if (this.gpaState.stage === "off" || !this.gpaState.awaitingConfirmation)
            return;
        if (!detectGpaConfirmation(text) && !/\[internal:gpa-confirm\]/i.test(text))
            return;
        this.advanceGpaStage();
    }
    listPermissionRules() {
        return this.permissionStore.listAlways();
    }
    forgetPermissionRule(key) {
        this.permissionStore.forgetAlways(key);
        return this.permissionStore.listAlways();
    }
    clearPermissionRules() {
        this.permissionStore.clearAlways();
        return this.permissionStore.listAlways();
    }
    latestAssistantText() {
        const session = this.runtime?.session;
        if (!session)
            return "";
        const messages = session.messages;
        for (let index = messages.length - 1; index >= 0; index -= 1) {
            const message = messages[index];
            if (message.role !== "assistant")
                continue;
            return contentToText(message.content);
        }
        return "";
    }
    scheduleLiveGpaUpdate() {
        if (this.gpaState.stage === "off")
            return;
        if (this.gpaLiveTimer)
            return;
        this.gpaLiveTimer = setTimeout(() => {
            this.gpaLiveTimer = undefined;
            this.updateGpaFromMessages(this.streamingAssistantText, { live: true });
        }, AgentHost.GPA_LIVE_UPDATE_MS);
    }
    flushLiveGpaUpdate() {
        if (!this.gpaLiveTimer)
            return;
        clearTimeout(this.gpaLiveTimer);
        this.gpaLiveTimer = undefined;
        if (this.streamingAssistantText) {
            this.updateGpaFromMessages(this.streamingAssistantText, { live: true });
        }
    }
    gpaStateChanged(previous, next) {
        if (previous.stage !== next.stage)
            return true;
        if (previous.awaitingConfirmation !== next.awaitingConfirmation)
            return true;
        if (previous.planTasks.length !== next.planTasks.length)
            return true;
        return previous.planTasks.some((task, index) => task.id !== next.planTasks[index]?.id || task.title !== next.planTasks[index]?.title || task.done !== next.planTasks[index]?.done);
    }
    /** Derive GPA plan/ACT progress from the latest assistant message. */
    updateGpaFromMessages(textOverride, options) {
        if (this.gpaState.stage === "off")
            return;
        const text = textOverride ?? this.latestAssistantText();
        const previous = this.gpaState;
        let next = this.gpaState;
        if (text) {
            if (next.stage === "plan") {
                next = { ...next, planTasks: liveReconcileGpaPlanTasks(next.planTasks, text) };
                if (text.trim())
                    this.gpaPlanBody = text;
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
        const finishedAct = next.stage === "act" && next.planTasks.length > 0 && next.planTasks.every((task) => task.done);
        // A fully completed ACT ends the one-shot GPA workflow. During streaming, wait for settle.
        if (finishedAct && !options?.live) {
            void this.persistGpaPlanFile("completed", next.planTasks.map((task) => ({ ...task, done: true })));
            next = { ...next, stage: "off", awaitingConfirmation: null };
            this.emit({ type: "toast", toastType: "info", message: "GPA 流程已完成，已自动关闭。" });
        }
        const changed = this.gpaStateChanged(previous, next);
        this.gpaState = { ...next, updatedAt: changed ? new Date().toISOString() : previous.updatedAt };
        if (options?.live) {
            if (changed)
                this.emit({ type: "gpa", gpa: this.gpaState });
            return;
        }
        if (!finishedAct && this.gpaState.planTasks.length > 0) {
            const progressed = previous.planTasks.filter((task) => task.done).length !==
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
    async maybeAutoContinueGpa() {
        if (this.gpaAutoContinuing)
            return;
        if (this.gpaSkipNextAutoContinue) {
            this.gpaSkipNextAutoContinue = false;
            return;
        }
        if (this.gpaState.stage !== "act")
            return;
        if (this.dialogs.hasPending())
            return;
        const tasks = this.gpaState.planTasks;
        if (tasks.length === 0)
            return;
        const doneCount = tasks.filter((task) => task.done).length;
        if (doneCount >= tasks.length)
            return;
        if (this.queue.steering.length > 0 || this.queue.followUp.length > 0)
            return;
        const nextTask = tasks.find((task) => !task.done);
        if (!nextTask)
            return;
        const madeProgress = doneCount > this.gpaAutoContinueDone;
        if (madeProgress) {
            this.gpaAutoContinueStreak = 0;
        }
        else {
            this.gpaAutoContinueStreak += 1;
            if (this.gpaAutoContinueStreak > AgentHost.MAX_GPA_NO_PROGRESS_CONTINUES)
                return;
        }
        this.gpaAutoContinueDone = doneCount;
        this.gpaAutoContinuing = true;
        try {
            await this.prompt({
                text: buildGpaContinuePrompt({ nextTask, doneCount, totalCount: tasks.length }),
            });
        }
        catch (error) {
            this.emit({
                type: "toast",
                toastType: "error",
                message: `GPA 自动续跑失败：${error instanceof Error ? error.message : String(error)}`,
            });
        }
        finally {
            this.gpaAutoContinuing = false;
        }
    }
    resetGpaRuntime() {
        this.gpaState = createDefaultGpaState();
        this.gpaAutoContinueDone = 0;
        this.gpaAutoContinueStreak = 0;
        this.gpaAutoContinuing = false;
        this.gpaSkipNextAutoContinue = false;
        this.gpaPlanBody = "";
    }
    currentSessionId() {
        return this.runtime?.session?.sessionId ?? "";
    }
    gpaPlanFileStatus() {
        if (this.gpaState.stage === "plan")
            return "awaiting_confirmation";
        if (this.gpaState.stage === "act") {
            return this.gpaState.planTasks.length > 0 && this.gpaState.planTasks.every((task) => task.done)
                ? "completed"
                : "in_progress";
        }
        if (this.gpaState.planTasks.some((task) => !task.done))
            return "in_progress";
        return "in_progress";
    }
    gpaResumePreview() {
        if (this.gpaState.planTasks.length === 0)
            return null;
        if (this.gpaState.stage === "off")
            return null;
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
    async persistGpaPlanFile(status, tasks = this.gpaState.planTasks, body = this.gpaPlanBody) {
        if (!this.cwd || tasks.length === 0)
            return;
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
        }
        catch (error) {
            this.emit({
                type: "toast",
                toastType: "warning",
                message: `写入 GPA 计划文件失败：${error instanceof Error ? error.message : String(error)}`,
            });
        }
    }
    async readGpaResumePreview() {
        if (!this.cwd)
            return null;
        try {
            const existing = await readGpaPlanFile(this.cwd);
            if (!gpaPlanHasIncompleteTasks(existing) || !existing)
                return null;
            return toGpaPlanResumePreview(existing, this.currentSessionId());
        }
        catch {
            return null;
        }
    }
    async tryRestoreGpaPlanFromFile() {
        if (!this.cwd)
            return false;
        const existing = await readGpaPlanFile(this.cwd);
        if (!gpaPlanHasIncompleteTasks(existing) || !existing)
            return false;
        if (existing.body.trim())
            this.gpaPlanBody = existing.body;
        if (existing.status === "awaiting_confirmation") {
            this.gpaState = {
                ...this.gpaState,
                stage: "plan",
                awaitingConfirmation: "plan",
                planTasks: existing.tasks,
                updatedAt: new Date().toISOString(),
            };
        }
        else {
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
        await this.persistGpaPlanFile(this.gpaState.stage === "plan" ? "awaiting_confirmation" : "in_progress", this.gpaState.planTasks);
        return true;
    }
    /** 打开项目/切换会话时只恢复时间线，不自动开跑。 */
    async softRestoreGpaPlanFromFile() {
        const restored = await this.tryRestoreGpaPlanFromFile();
        if (!restored)
            return;
        const pending = this.gpaState.planTasks.filter((task) => !task.done).length;
        this.emit({
            type: "toast",
            toastType: "info",
            message: this.gpaState.stage === "plan"
                ? "已恢复未确认的 GPA 计划，确认后即可继续执行。"
                : `已恢复未完成的 GPA 计划，剩余 ${pending} 项。点击「继续执行」接着做。`,
        });
        this.pushSnapshot();
    }
    async abandonGpaPlanFile() {
        if (!this.cwd)
            return false;
        try {
            const existing = await readGpaPlanFile(this.cwd);
            if (!existing || existing.status === "completed" || existing.status === "abandoned")
                return false;
            await writeGpaPlanFile(this.cwd, {
                status: "abandoned",
                threadId: existing.threadId || this.currentSessionId(),
                updatedAt: new Date().toISOString(),
                tasks: existing.tasks,
                body: existing.body,
            });
            return true;
        }
        catch (error) {
            this.emit({
                type: "toast",
                toastType: "warning",
                message: `废弃 GPA 计划失败：${error instanceof Error ? error.message : String(error)}`,
            });
            return false;
        }
    }
    async navigateTree(targetId, summarize = false) {
        await this.requireSession().navigateTree(targetId, { summarize });
        this.pushSnapshot();
        const snapshot = this.snapshot();
        if (!snapshot)
            throw new Error("导航会话树失败");
        return snapshot;
    }
    getTree(path) {
        const currentFile = this.runtime?.session?.sessionFile;
        if (path && path !== currentFile) {
            return serializeTree(SessionManager.open(path).getTree());
        }
        const session = this.runtime?.session;
        if (!session)
            return [];
        return serializeTree(session.sessionManager.getTree());
    }
    async compact(instructions) {
        await this.requireSession().compact(instructions);
        this.pushSnapshot();
    }
    async reload() {
        await this.requireSession().reload();
        await this.attachSession();
    }
    async listModels() {
        const runtime = this.requireModels();
        await this.migrateModelReasoningFlags();
        await runtime.refresh({ allowNetwork: false });
        const available = new Set((await runtime.getAvailable().catch(() => runtime.getAvailableSnapshot())).map((model) => `${model.provider}/${model.id}`));
        const models = runtime.getModels().map((model) => {
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
        const providers = runtime.getProviders().map((provider) => {
            const auth = provider.auth;
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
    async setModel(provider, id) {
        await this.ensureModelReasoning(provider, id);
        const model = this.requireModels().getModel(provider, id);
        if (!model)
            throw new Error(`找不到模型 ${provider}/${id}`);
        await this.requireSession().setModel(model);
        // 对话窗口切换模型后，优先用该模型配置的默认思考等级，否则用全局默认。
        const preferred = this.preferredThinkingLevel(provider, id);
        if (preferred)
            this.requireSession().setThinkingLevel(preferred);
        this.runtime?.services.settingsManager.setDefaultModelAndProvider(provider, id);
        this.pushSnapshot();
    }
    async setThinkingLevel(level) {
        const session = this.requireSession();
        const model = session.model;
        if (model)
            await this.ensureModelReasoning(model.provider, model.id);
        const live = this.requireSession();
        live.setThinkingLevel(level);
        if (model) {
            this.runtime?.services.settingsManager.setModelThinkingLevel(model.provider, model.id, live.thinkingLevel);
        }
        this.pushSnapshot();
    }
    getModelsFile() {
        const path = this.modelsPath();
        return { path, ...readModelsFile(path) };
    }
    async saveModelsFile(file) {
        writeModelsFile(this.modelsPath(), file);
        await this.requireModels().refresh({ allowNetwork: false });
    }
    async refreshModels() {
        await this.requireModels().refresh({ allowNetwork: true });
    }
    async login(providerId, type) {
        const runtime = this.requireModels();
        await runtime.login(providerId, type, {
            prompt: async (prompt) => {
                if (prompt.type === "select") {
                    const request = {
                        kind: "select",
                        title: prompt.message,
                        options: prompt.options.map((option) => ({
                            id: option.id,
                            label: option.label,
                            description: option.description,
                        })),
                    };
                    const selected = await this.dialogs.ask(request);
                    if (typeof selected !== "string")
                        throw new Error("已取消登录");
                    return selected;
                }
                const kind = prompt.type === "secret" ? "secret" : prompt.type === "manual_code" ? "manual_code" : "input";
                const value = await this.dialogs.input(prompt.message, prompt.placeholder, kind);
                if (!value)
                    throw new Error("已取消登录");
                return value;
            },
            notify: (event) => {
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
    async logout(providerId) {
        await this.requireModels().logout(providerId);
    }
    async setApiKey(providerId, apiKey) {
        await this.requireModels().setRuntimeApiKey(providerId, apiKey);
    }
    getSettings() {
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
    updateSettings(patch) {
        const settings = this.requireRuntime().services.settingsManager;
        if (patch.defaultProvider && patch.defaultModel) {
            settings.setDefaultModelAndProvider(patch.defaultProvider, patch.defaultModel);
        }
        else if (patch.defaultProvider) {
            settings.setDefaultProvider(patch.defaultProvider);
        }
        else if (patch.defaultModel) {
            settings.setDefaultModel(patch.defaultModel);
        }
        if (patch.defaultThinkingLevel) {
            settings.setDefaultThinkingLevel(patch.defaultThinkingLevel);
            this.runtime?.session?.setThinkingLevel(patch.defaultThinkingLevel);
            this.pushSnapshot();
        }
        if (patch.hideThinkingBlock !== undefined)
            settings.setHideThinkingBlock(patch.hideThinkingBlock);
        if (patch.compactionEnabled !== undefined)
            settings.setCompactionEnabled(patch.compactionEnabled);
        if (patch.retryEnabled !== undefined)
            settings.setRetryEnabled(patch.retryEnabled);
        if (patch.steeringMode)
            settings.setSteeringMode(patch.steeringMode);
        if (patch.followUpMode)
            settings.setFollowUpMode(patch.followUpMode);
        if (patch.defaultProjectTrust)
            settings.setDefaultProjectTrust(patch.defaultProjectTrust);
        if (patch.theme)
            settings.setTheme(patch.theme);
    }
    trustProject(trusted, includeParent = false) {
        const cwd = this.requireRuntime().cwd;
        const store = new ProjectTrustStore(getAgentDir());
        if (includeParent) {
            store.set(dirname(cwd), true);
        }
        else {
            store.set(cwd, trusted);
        }
        this.requireRuntime().services.settingsManager.setProjectTrusted(trusted);
    }
    async exportHtml(outputPath) {
        return this.requireSession().exportToHtml(outputPath);
    }
    exportJsonl(outputPath) {
        return this.requireSession().exportToJsonl(outputPath);
    }
    async importJsonl(inputPath) {
        const result = await this.requireRuntime().importFromJsonl(inputPath, this.cwd);
        if (result.cancelled)
            throw new Error("导入被取消");
        await this.attachSession();
        const snapshot = this.snapshot();
        if (!snapshot)
            throw new Error("导入失败");
        return snapshot;
    }
    copySessionFile(destination) {
        const file = this.requireSession().sessionFile;
        if (!file || !existsSync(file))
            throw new Error("当前会话尚未落盘");
        copyFileSync(file, destination);
        return destination;
    }
    searchFiles(query) {
        return searchProjectFiles(this.runtime?.cwd ?? this.cwd, query);
    }
    getCommands() {
        const builtins = BUILTIN_SLASH_COMMANDS;
        const session = this.runtime?.session;
        if (!session)
            return builtins;
        const templates = session.promptTemplates.map((template) => ({
            name: template.name,
            description: template.description,
            source: "prompt",
        }));
        const skills = this.collectResources().skills.map((skill) => ({
            name: `skill:${skill.name}`,
            description: skill.description,
            source: "skill",
        }));
        const runner = session.extensionRunner;
        const extensions = (runner.getRegisteredCommands?.() ?? []).map((command) => ({
            name: command.invocationName,
            description: command.description,
            source: "extension",
        }));
        return [...builtins, ...templates, ...skills, ...extensions];
    }
    getSessionInfo() {
        return this.requireSession().getSessionStats();
    }
    packageContext() {
        const cwd = this.runtime?.cwd ?? this.cwd;
        return createPackageContext(cwd, this.runtime?.services.settingsManager);
    }
    bindPackageProgress() {
        const ctx = this.packageContext();
        ctx.pm.setProgressCallback((event) => {
            if (!event.message)
                return;
            this.emit({
                type: "toast",
                toastType: event.type === "error" ? "error" : "info",
                message: event.message,
            });
        });
        return ctx;
    }
    async afterPackageChange(ctx) {
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
    async listCatalog() {
        const packages = await fetchPiPackages(false);
        return { packages, updatedAt: catalogUpdatedAt() };
    }
    async refreshCatalog() {
        const packages = await fetchPiPackages(true);
        return { packages, updatedAt: catalogUpdatedAt() };
    }
    async listPackages() {
        return listInstalled(this.packageContext());
    }
    async installPackage(name) {
        const ctx = this.bindPackageProgress();
        await ctx.pm.installAndPersist(toNpmSource(name));
        return this.afterPackageChange(ctx);
    }
    async removePackage(source) {
        const ctx = this.bindPackageProgress();
        await ctx.pm.removeAndPersist(toNpmSource(source));
        return this.afterPackageChange(ctx);
    }
    async toggleInstalledResource(item, enabled) {
        const ctx = this.packageContext();
        toggleResource(ctx, item, enabled);
        return this.afterPackageChange(ctx);
    }
    async importSkill(sourcePath) {
        const ctx = this.packageContext();
        importLocalSkill(sourcePath);
        return this.afterPackageChange(ctx);
    }
    async dispose() {
        this.unsubscribe?.();
        if (this.runtime) {
            await this.runtime.dispose();
            this.runtime = undefined;
        }
    }
}
