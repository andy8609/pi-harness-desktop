import type { CatalogPackage, DesktopSettings, InstalledResource, ModelOption, ModelsFile, PackageInventory, PromptPayload, ProviderOption, QueueMutation, SessionListItem, SessionSnapshot, SlashCommand, StreamEvent, ThinkingLevel, TreeNode } from "@shared/types";
import { type GpaState } from "@shared/gpa";
import { type GpaPlanResumePreview } from "@shared/gpa-plan-file";
type AuthType = "api_key" | "oauth";
import type { DialogBroker } from "./dialog-broker";
type EventSink = (event: StreamEvent) => void;
export declare class AgentHost {
    private readonly dialogs;
    private readonly emit;
    private modelRuntime;
    private runtime;
    private unsubscribe;
    private queue;
    /**
     * 队列消息的图片附件（文本 → 图片）：pi 的队列镜像只含文本，
     * 编辑/删除队列消息需要清空重建，重建时用它恢复附件。
     */
    private queuedImages;
    /** 重建队列期间（clearQueue → 重新入队）暂停图片映射的清理，避免误删尚未重建的条目。 */
    private restoringQueue;
    /** 队列操作（删除/编辑/转 steer）的串行执行链，避免并发重建互相覆盖。 */
    private queueMutationChain;
    private cwd;
    private activityLabel;
    private activityStartedAt;
    private activityTimer;
    private gpaState;
    /**
     * GPA ACT 自动续跑基线：上次自动续跑时的已完成任务数。
     * 与 workagent 一致：ACT 未完成时默认续跑，不因「更新计划」而停下来等用户输入继续。
     */
    private gpaAutoContinueDone;
    /** 连续无进展续跑次数。超过上限才停，避免模型空转。 */
    private gpaAutoContinueStreak;
    private gpaAutoContinuing;
    /** 用户中止后跳过下一次自动续跑，避免立刻又被拉起来。 */
    private gpaSkipNextAutoContinue;
    /** 最近一次 PLAN 正文，写入 .codexh/gpa-plan.md 供关闭后恢复。 */
    private gpaPlanBody;
    /** 当前助手消息的流式正文，供 Updated Plan 实时解析。 */
    private streamingAssistantText;
    private gpaLiveTimer;
    private readonly permissionStore;
    private static readonly MAX_GPA_NO_PROGRESS_CONTINUES;
    private static readonly GPA_LIVE_UPDATE_MS;
    constructor(dialogs: DialogBroker, emit: EventSink);
    initialize(): Promise<void>;
    isBusy(): boolean;
    pushUiSnapshot(): void;
    getCwd(): string;
    private requireRuntime;
    private requireSession;
    private requireModels;
    private modelsPath;
    private customModelConfig;
    private preferredThinkingLevel;
    private thinkingLevelsForModel;
    private thinkingLevelsForCurrentModel;
    /** models.json 里勾选了思考等级但没写 reasoning 时，补上以便 SDK 真正接受思考等级。 */
    private migrateModelReasoningFlags;
    private ensureModelReasoning;
    private resolveTrust;
    private collectResources;
    snapshot(): SessionSnapshot | undefined;
    private pushSnapshot;
    private setActivity;
    private clearActivity;
    private extensionUi;
    private attachSession;
    private handleSessionEvent;
    private createFactory;
    openProject(cwd: string): Promise<SessionSnapshot>;
    prompt(payload: PromptPayload): Promise<void>;
    abort(): Promise<void>;
    steer(text: string): Promise<void>;
    followUp(text: string): Promise<void>;
    /**
     * 修改待发送队列：删除单条、编辑文本、把 follow-up 转为 steer。
     * pi 不支持单条增删，实现为 clearQueue 后按剩余顺序重建（图片附件从映射恢复）。
     * 队列操作串行执行：并发的 clearQueue + 重建会互相覆盖导致消息丢失。
     */
    mutateQueue(action: QueueMutation): Promise<void>;
    private applyQueueMutation;
    /** 清理已不在队列中的消息的图片映射，避免陈旧数据累积。 */
    private pruneQueuedImages;
    newSession(): Promise<SessionSnapshot>;
    switchSession(path: string): Promise<SessionSnapshot>;
    listSessions(): Promise<SessionListItem[]>;
    nameSession(name: string): void;
    fork(entryId: string): Promise<SessionSnapshot>;
    clone(): Promise<SessionSnapshot>;
    /**
     * Edit a persisted user message and resend it: fork the session to just
     * before that entry, then submit the new text as a fresh turn.
     */
    editAndResend(entryId: string, payload: PromptPayload): Promise<void>;
    getGpaState(): GpaState;
    peekGpaPlan(): Promise<GpaPlanResumePreview | null>;
    /**
     * GPA 开关。开启时若项目里有未完成计划，先询问是继续还是废弃后重来；
     * 关闭时把当前进度写回 .codexh/gpa-plan.md，下次可以接着执行。
     */
    setGpaEnabled(enabled: boolean): Promise<GpaState>;
    /**
     * User confirmed the current stage. Advance the state machine and send a
     * short instruction so the model continues in the next stage.
     */
    confirmGpa(): Promise<void>;
    resumeGpaPlan(): Promise<void>;
    resetGpa(): Promise<GpaState>;
    abandonGpaPlan(): Promise<GpaState>;
    /** Move to the next stage without sending a message (used by text confirmation). */
    private advanceGpaStage;
    /** A short confirmation message (e.g. "确认") advances the pending stage. */
    private maybeAdvanceGpaOnConfirmation;
    listPermissionRules(): string[];
    forgetPermissionRule(key: string): string[];
    clearPermissionRules(): string[];
    private latestAssistantText;
    private scheduleLiveGpaUpdate;
    private flushLiveGpaUpdate;
    private gpaStateChanged;
    /** Derive GPA plan/ACT progress from the latest assistant message. */
    private updateGpaFromMessages;
    /**
     * ACT 自动续跑，对齐 workagent 的 terminal disposition：
     * 计划未全部完成且不是在等用户决策时，必须继续下一项，不能因 update plan 停住。
     */
    private maybeAutoContinueGpa;
    private resetGpaRuntime;
    private currentSessionId;
    private gpaPlanFileStatus;
    private gpaResumePreview;
    private persistGpaPlanFile;
    private readGpaResumePreview;
    private tryRestoreGpaPlanFromFile;
    /** 打开项目/切换会话时只恢复时间线，不自动开跑。 */
    private softRestoreGpaPlanFromFile;
    private abandonGpaPlanFile;
    navigateTree(targetId: string, summarize?: boolean): Promise<SessionSnapshot>;
    getTree(path?: string): TreeNode[];
    compact(instructions?: string): Promise<void>;
    reload(): Promise<void>;
    listModels(): Promise<{
        models: ModelOption[];
        providers: ProviderOption[];
    }>;
    setModel(provider: string, id: string): Promise<void>;
    setThinkingLevel(level: ThinkingLevel): Promise<void>;
    getModelsFile(): {
        path: string;
        file: ModelsFile;
        raw: string;
        error?: string;
    };
    saveModelsFile(file: ModelsFile): Promise<void>;
    refreshModels(): Promise<void>;
    login(providerId: string, type: AuthType): Promise<void>;
    logout(providerId: string): Promise<void>;
    setApiKey(providerId: string, apiKey: string): Promise<void>;
    getSettings(): DesktopSettings;
    updateSettings(patch: DesktopSettings): void;
    trustProject(trusted: boolean, includeParent?: boolean): void;
    exportHtml(outputPath?: string): Promise<string>;
    exportJsonl(outputPath?: string): string;
    importJsonl(inputPath: string): Promise<SessionSnapshot>;
    copySessionFile(destination: string): string;
    searchFiles(query: string): import("@shared/types").FileSearchResult[];
    getCommands(): SlashCommand[];
    getSessionInfo(): Record<string, unknown>;
    private packageContext;
    private bindPackageProgress;
    private afterPackageChange;
    listCatalog(): Promise<{
        packages: CatalogPackage[];
        updatedAt?: number;
    }>;
    refreshCatalog(): Promise<{
        packages: CatalogPackage[];
        updatedAt?: number;
    }>;
    listPackages(): Promise<PackageInventory>;
    installPackage(name: string): Promise<PackageInventory>;
    removePackage(source: string): Promise<PackageInventory>;
    toggleInstalledResource(item: InstalledResource, enabled: boolean): Promise<PackageInventory>;
    importSkill(sourcePath: string): Promise<PackageInventory>;
    dispose(): Promise<void>;
}
export {};
