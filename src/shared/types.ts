import type { GpaState } from "./gpa";
import type { GpaPlanResumePreview } from "./gpa-plan-file";

export type AppView = "chat" | "sessions" | "extensions" | "skills" | "mcp" | "models" | "settings";

export type CatalogKind = "extension" | "skill";

export interface CatalogPackage {
  name: string;
  version: string;
  description: string;
  keywords: string[];
  kinds: CatalogKind[];
  npmUrl: string;
}

export type ResourceKind = "extensions" | "skills";

export interface InstalledResource {
  name: string;
  path: string;
  enabled: boolean;
  source: string;
  scope: "user" | "project" | "temporary";
  origin: "package" | "top-level";
  packageSource?: string;
  relativePath?: string;
  kind: ResourceKind;
}

export interface ConfiguredPackageInfo {
  source: string;
  scope: "user" | "project";
  filtered: boolean;
}

export interface PackageInventory {
  extensions: InstalledResource[];
  skills: InstalledResource[];
  packages: ConfiguredPackageInfo[];
}

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export const THINKING_LEVELS: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

/** 勾了 reasoning 但没写 thinkingLevels 时，下拉框与模型页共用的默认档位。 */
export const DEFAULT_REASONING_LEVELS: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high"];

export const THINKING_LEVEL_LABEL: Record<ThinkingLevel, string> = {
  off: "关闭",
  minimal: "最低",
  low: "低",
  medium: "中",
  high: "高",
  xhigh: "很高",
  max: "最高",
};

export function orderedThinkingLevels(levels: readonly string[]): ThinkingLevel[] {
  const allowed = new Set(levels);
  return THINKING_LEVELS.filter((level) => allowed.has(level));
}

export type StreamingBehavior = "steer" | "followUp";

export interface ChatContentPart {
  type: string;
  text?: string;
  thinking?: string;
  data?: string;
  mimeType?: string;
  name?: string;
  id?: string;
  arguments?: unknown;
}

export interface ChatMessage {
  role: string;
  content: string | ChatContentPart[];
  /** Persisted session entry id, used for edit/fork/retry. Absent for live stream chunks. */
  entryId?: string;
  timestamp?: number | string;
  customType?: string;
  toolCallId?: string;
  toolName?: string;
  isError?: boolean;
  details?: unknown;
  usage?: {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
    cost?: { total?: number };
  };
  stopReason?: string;
  errorMessage?: string;
  command?: string;
  output?: string;
  exitCode?: number;
  cancelled?: boolean;
}

export interface SessionUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  contextTokens?: number | null;
  contextWindow?: number;
  contextPercent?: number | null;
}

export interface ModelRef {
  provider: string;
  id: string;
  name?: string;
  contextWindow?: number;
  maxTokens?: number;
  reasoning?: boolean;
}

export interface ResourceSummary {
  skills: Array<{ name: string; description?: string }>;
  prompts: Array<{ name: string; description?: string }>;
  extensions: Array<{ name: string; path?: string }>;
  agentsFiles: Array<{ path: string }>;
}

export interface ResourceFile {
  kind: "prompt" | "agents";
  name: string;
  path: string;
  description?: string;
  argumentHint?: string;
  content: string;
  scope?: "user" | "project" | "temporary";
  truncated?: boolean;
}

export interface ResourceFiles {
  prompts: ResourceFile[];
  agentsFiles: ResourceFile[];
}

export type ResourceCreateScope = "user" | "project";

export interface CreateResourceFileInput {
  kind: "prompt" | "agents";
  scope: ResourceCreateScope;
  name?: string;
  description?: string;
  content?: string;
}

export interface WatchdogReport {
  id: string;
  round: number;
  elapsedMs: number;
  status: "running" | "done" | "failed";
  summary: string;
  startedAt: number;
}

export interface SessionSnapshot {
  cwd: string;
  sessionId: string;
  sessionName?: string;
  displayName?: string;
  sessionFile?: string;
  messages: ChatMessage[];
  isStreaming: boolean;
  isCompacting: boolean;
  model?: ModelRef;
  thinkingLevel: ThinkingLevel;
  availableThinkingLevels: ThinkingLevel[];
  usage: SessionUsage;
  queue: { steering: string[]; followUp: string[] };
  resources: ResourceSummary;
  diagnostics: Array<{ type: string; message: string }>;
  modelFallbackMessage?: string;
  projectTrusted: boolean;
  fullTrust: boolean;
  gpa?: GpaState;
  gpaPlanResume?: GpaPlanResumePreview | null;
  watchdogReports?: WatchdogReport[];
}

export interface SessionListItem {
  path: string;
  id: string;
  name?: string;
  cwd: string;
  created: string;
  modified: string;
  messageCount: number;
  firstMessage: string;
}

/**
 * 会话树的传输格式：扁平节点。
 *
 * 不用嵌套结构是因为 Electron 的 contextBridge 序列化有 1000 层深度上限，
 * 长会话的分支链会超过该限制并报 “recursion depth exceeded”。
 * 渲染层用 `lib/tree.ts` 的 `buildTree()` 重建层级。
 */
export interface FlatTreeNode {
  id: string;
  type: string;
  timestamp?: string;
  label?: string;
  summary: string;
  /** 父节点 id；根节点为 null。 */
  parentId: string | null;
}

/** 渲染层重建后的会话树节点（带子节点）。 */
export interface TreeNode {
  id: string;
  type: string;
  timestamp?: string;
  label?: string;
  summary: string;
  children: TreeNode[];
}

export interface ModelOption {
  provider: string;
  id: string;
  name: string;
  contextWindow?: number;
  maxTokens?: number;
  reasoning?: boolean;
  available: boolean;
  thinkingLevels?: ThinkingLevel[];
  defaultThinkingLevel?: ThinkingLevel | null;
}

export interface ProviderOption {
  id: string;
  name: string;
  authConfigured: boolean;
  authSource?: string;
  isCustom: boolean;
  supportsApiKey: boolean;
  supportsOAuth: boolean;
}

/** models.dev 单模型参考价，单位与 pi 的 models.json 一致（美元 / 百万 token）。 */
export interface ModelDevCost {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
}

/**
 * models.dev 目录里某个模型的默认元数据。
 * 只用来补 models.json 里用户没填过的字段，不覆盖显式配置。
 */
export interface ModelDevDefaults {
  id: string;
  name?: string;
  contextWindow?: number;
  maxTokens?: number;
  reasoning?: boolean;
  /** pi 只认 text / image，models.dev 的 pdf/audio/video 会被过滤掉。 */
  input?: string[];
  thinkingLevels?: ThinkingLevel[];
  defaultThinkingLevel?: ThinkingLevel | null;
  cost?: ModelDevCost;
  /** 命中的 models.dev provider key，用于在界面上标注数据来源。 */
  source: string;
}

/** 一次查询：按 provider 身份 + 模型 id 列表，批量取默认元数据。 */
export interface ModelDevQuery {
  providerId?: string;
  name?: string;
  baseUrl?: string;
  modelIds: string[];
}

export interface CustomModelConfig {
  id: string;
  name?: string;
  reasoning?: boolean;
  input?: string[];
  contextWindow?: number;
  maxTokens?: number;
  api?: string;
  cost?: {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
  };
  compat?: Record<string, unknown>;
  /** pi 会用它把桌面思考档位映射成网关真实支持的值（如 minimal → low）。 */
  thinkingLevelMap?: Record<string, string | null>;
  /** Desktop UI extension fields (ignored by pi). */
  thinkingLevels?: string[];
  defaultThinkingLevel?: string | null;
}

export interface CustomProviderConfig {
  baseUrl?: string;
  api?: string;
  apiKey?: string;
  headers?: Record<string, string>;
  authHeader?: boolean;
  compat?: Record<string, unknown>;
  models?: CustomModelConfig[];
  /** Desktop UI extension fields (ignored by pi). */
  name?: string;
  enabled?: boolean;
}

export interface ModelsFile {
  providers?: Record<string, CustomProviderConfig>;
  modelOverrides?: Record<string, unknown>;
}

export interface DesktopSettings {
  defaultProvider?: string;
  defaultModel?: string;
  defaultThinkingLevel?: ThinkingLevel;
  hideThinkingBlock?: boolean;
  compactionEnabled?: boolean;
  retryEnabled?: boolean;
  steeringMode?: "all" | "one-at-a-time";
  followUpMode?: "all" | "one-at-a-time";
  defaultProjectTrust?: "ask" | "always" | "never";
  theme?: string;
}

/** 桌面界面皮肤：深色 / 浅色 / 跟随系统。与 pi CLI 的 settings.theme 无关。 */
export type ThemeMode = "dark" | "light" | "system";

export interface SlashCommand {
  name: string;
  description?: string;
  source: "builtin" | "extension" | "prompt" | "skill";
  argumentHint?: string;
}

export interface PromptImage {
  type: "image";
  data: string;
  mimeType: string;
}

export interface PromptPayload {
  text: string;
  images?: PromptImage[];
  streamingBehavior?: StreamingBehavior;
}

/** 待发送队列的单条修改操作（pi 不支持单条增删，实现为 clearQueue 后重建）。 */
export interface QueueMutation {
  type: "remove" | "update" | "toSteer";
  /** 目标消息的文本（pi 队列镜像以文本标识消息）。 */
  text: string;
  /** update 时的新文本。 */
  newText?: string;
}

export type DialogKind = "select" | "confirm" | "input" | "secret" | "manual_code" | "questions" | "permission";

export interface DialogQuestion {
  id: string;
  label: string;
  prompt: string;
  options: Array<{ id: string; label: string; description?: string }>;
  allowFreeText?: boolean;
}

export interface PermissionPrompt {
  toolName: string;
  risk: string;
  detail: string;
  options: Array<{ id: string; label: string }>;
}

export interface DialogRequest {
  id: string;
  kind: DialogKind;
  title: string;
  message?: string;
  placeholder?: string;
  options?: Array<{ id: string; label: string; description?: string }>;
  questions?: DialogQuestion[];
  permission?: PermissionPrompt;
}

export interface DialogResponse {
  id: string;
  cancelled?: boolean;
  value?: string | boolean;
}

export interface ActivityStatus {
  message: string;
  startedAt: number;
  elapsed?: number;
}

export interface StreamEvent {
  type:
    | "text_delta"
    | "thinking_delta"
    | "tool_start"
    | "tool_update"
    | "tool_end"
    | "bash_delta"
    | "queue_update"
    | "compaction"
    | "activity"
    | "toast"
    | "snapshot"
    | "gpa"
    | "watchdog";
  delta?: string;
  toolCallId?: string;
  toolName?: string;
  args?: unknown;
  result?: unknown;
  isError?: boolean;
  steering?: string[];
  followUp?: string[];
  reason?: string;
  toastType?: "info" | "warning" | "error";
  message?: string;
  elapsed?: number;
  snapshot?: SessionSnapshot;
  gpa?: GpaState;
  watchdog?: WatchdogReport;
}

export interface FileSearchResult {
  path: string;
  relative: string;
}

export type WorkPanelTab = "files" | "usage" | "subagents";

export interface FileEntry {
  name: string;
  path: string;
  relative: string;
  isDir: boolean;
}

export interface FileContent {
  path: string;
  relative: string;
  content: string;
  truncated: boolean;
  binary: boolean;
}

export interface WorkPanelState {
  open: boolean;
  tab: WorkPanelTab;
  width: number;
}
