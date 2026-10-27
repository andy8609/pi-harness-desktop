import { create } from "zustand";
import type {
  ActivityStatus,
  AppView,
  ChatMessage,
  DesktopSettings,
  DialogRequest,
  FileSearchResult,
  ModelOption,
  ModelsFile,
  ProviderOption,
  SessionListItem,
  SessionSnapshot,
  SlashCommand,
  StreamEvent,
  ThinkingLevel,
  ThemeMode,
  TreeNode,
  WorkPanelState,
} from "@shared/types";
import { activityLabel, polishActivity } from "../lib/tool-summary";
import { applyTheme, loadThemeMode, saveThemeMode } from "../lib/theme";

let lastTool: { name?: string; args?: unknown } = {};

const WORK_PANEL_KEY = "pi-desktop:work-panel";
const WORK_PANEL_MIN_WIDTH = 260;
const WORK_PANEL_MAX_WIDTH = 720;

function clampWorkPanelWidth(width: number): number {
  if (!Number.isFinite(width)) return 360;
  return Math.min(WORK_PANEL_MAX_WIDTH, Math.max(WORK_PANEL_MIN_WIDTH, Math.round(width)));
}

function loadWorkPanel(): WorkPanelState {
  try {
    const raw = localStorage.getItem(WORK_PANEL_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<WorkPanelState>;
      return {
        open: parsed.open ?? false,
        tab: parsed.tab === "usage" ? "usage" : parsed.tab === "subagents" ? "subagents" : "files",
        width: clampWorkPanelWidth(parsed.width ?? 360),
      };
    }
  } catch {
    // ignore malformed prefs
  }
  return { open: false, tab: "files", width: 360 };
}

function persistWorkPanel(state: WorkPanelState): void {
  try {
    localStorage.setItem(WORK_PANEL_KEY, JSON.stringify(state));
  } catch {
    // ignore storage failures
  }
}

interface AppState {
  view: AppView;
  snapshot?: SessionSnapshot;
  sessions: SessionListItem[];
  models: ModelOption[];
  providers: ProviderOption[];
  modelsFile?: { path: string; file: ModelsFile; raw: string; error?: string };
  settings: DesktopSettings;
  appVersion: string;
  /** 首次引导是否完成：完成前界面显示骨架，避免「未打开项目」空态闪烁。 */
  bootstrapped: boolean;
  theme: ThemeMode;
  commands: SlashCommand[];
  tree: TreeNode[];
  files: FileSearchResult[];
  dialog?: DialogRequest;
  toasts: Array<{ id: number; type: string; message: string }>;
  streamingText: string;
  streamingThinking: string;
  busy: boolean;
  activity?: ActivityStatus;
  pendingUser?: ChatMessage;
  error?: string;
  workPanel: WorkPanelState;
  /** 待插入输入框的文件引用队列（工作区右键"添加为引用"），由 Composer 消费后清空。 */
  referenceQueue: string[];
  /** 按会话保存未发送的输入，切换侧栏菜单后回来不会丢。 */
  composerDrafts: Record<string, string>;
  pushReference: (path: string) => void;
  setComposerDraft: (sessionId: string, text: string) => void;
  setWorkPanel: (patch: Partial<WorkPanelState>) => void;
  toggleWorkPanel: () => void;
  setView: (view: AppView) => void;
  setTheme: (theme: ThemeMode) => void;
  applySnapshot: (snapshot?: SessionSnapshot | null) => void;
  handleEvent: (event: StreamEvent) => void;
  setDialog: (dialog?: DialogRequest) => void;
  pushToast: (type: string, message: string) => void;
  dismissToast: (id: number) => void;
}

let toastId = 1;
const toastTimers = new Map<number, ReturnType<typeof setTimeout>>();

function scheduleToastDismiss(id: number, type: string): void {
  const existing = toastTimers.get(id);
  if (existing) clearTimeout(existing);
  const delay = type === "error" ? 6000 : 3500;
  toastTimers.set(
    id,
    setTimeout(() => {
      toastTimers.delete(id);
      useAppStore.getState().dismissToast(id);
    }, delay),
  );
}

function keepPendingUser(
  snapshot: SessionSnapshot,
  pending: ChatMessage | undefined,
  localMessages: ChatMessage[] = [],
): { snapshot: SessionSnapshot; pendingUser?: ChatMessage } {
  if (!pending) return { snapshot, pendingUser: undefined };
  const incomingUsers = snapshot.messages.filter((message) => message.role === "user").length;
  const localUsers = localMessages.filter((message) => message.role === "user").length;
  if (incomingUsers >= localUsers && localUsers > 0) return { snapshot, pendingUser: undefined };
  return {
    snapshot: { ...snapshot, isStreaming: true, messages: [...snapshot.messages, pending] },
    pendingUser: pending,
  };
}

function upsertToolCall(messages: ChatMessage[], toolCallId?: string, toolName?: string, args?: unknown): ChatMessage[] {
  const next = [...messages];
  const last = next[next.length - 1];
  const part = { type: "toolCall", id: toolCallId, name: toolName, arguments: args };
  if (!last || last.role !== "assistant") {
    next.push({ role: "assistant", content: [part] });
    return next;
  }
  const content = Array.isArray(last.content) ? [...last.content] : [];
  if (!toolCallId || !content.some((item) => item.id === toolCallId)) content.push(part);
  next[next.length - 1] = { ...last, content };
  return next;
}
function mergeAssistantDelta(messages: ChatMessage[], field: "text" | "thinking", delta: string): ChatMessage[] {
  const next = [...messages];
  const last = next[next.length - 1];
  if (!last || last.role !== "assistant") {
    next.push({
      role: "assistant",
      content: field === "text" ? [{ type: "text", text: delta }] : [{ type: "thinking", thinking: delta }],
    });
    return next;
  }
  const content = Array.isArray(last.content) ? [...last.content] : last.content ? [{ type: "text", text: String(last.content) }] : [];
  const index = content.findIndex((part) => (field === "text" ? part.type === "text" : part.type === "thinking"));
  if (index >= 0) {
    const part = { ...content[index] };
    if (field === "text") part.text = `${part.text ?? ""}${delta}`;
    else part.thinking = `${part.thinking ?? ""}${delta}`;
    content[index] = part;
  } else {
    content.push(field === "text" ? { type: "text", text: delta } : { type: "thinking", thinking: delta });
  }
  next[next.length - 1] = { ...last, content };
  return next;
}

export const useAppStore = create<AppState>((set) => ({
  view: "chat",
  sessions: [],
  models: [],
  providers: [],
  settings: {},
  appVersion: "",
  bootstrapped: false,
  theme: loadThemeMode(),
  commands: [],
  tree: [],
  files: [],
  toasts: [],
  streamingText: "",
  streamingThinking: "",
  busy: false,
  workPanel: loadWorkPanel(),
  referenceQueue: [],
  composerDrafts: {},
  pushReference: (path) =>
    set((state) => ({ referenceQueue: [...state.referenceQueue, path] })),
  setComposerDraft: (sessionId, text) =>
    set((state) => {
      if (!sessionId) return state;
      if (text === "") {
        const { [sessionId]: _removed, ...rest } = state.composerDrafts;
        return { composerDrafts: rest };
      }
      return { composerDrafts: { ...state.composerDrafts, [sessionId]: text } };
    }),
  setWorkPanel: (patch) =>
    set((state) => {
      const next = { ...state.workPanel, ...patch };
      next.width = clampWorkPanelWidth(next.width);
      persistWorkPanel(next);
      return { workPanel: next };
    }),
  toggleWorkPanel: () =>
    set((state) => {
      const next = { ...state.workPanel, open: !state.workPanel.open };
      persistWorkPanel(next);
      return { workPanel: next };
    }),
  setView: (view) => set({ view }),
  setTheme: (theme) => {
    saveThemeMode(theme);
    applyTheme(theme);
    set({ theme });
  },
  applySnapshot: (snapshot) =>
    set({
      snapshot: snapshot ?? undefined,
      streamingText: "",
      streamingThinking: "",
      busy: snapshot?.isStreaming ?? false,
      pendingUser: undefined,
      activity: undefined,
    }),
  handleEvent: (event) => {
    if (event.type === "snapshot" && event.snapshot) {
      set((state) => {
        const merged = keepPendingUser(event.snapshot!, state.pendingUser, state.snapshot?.messages ?? []);
        const working = merged.snapshot.isStreaming || merged.snapshot.isCompacting || Boolean(merged.pendingUser);
        return {
          snapshot: merged.snapshot,
          pendingUser: merged.pendingUser,
          streamingText: working ? state.streamingText : "",
          streamingThinking: working ? state.streamingThinking : "",
          busy: working,
          activity: working ? state.activity : undefined,
        };
      });
      return;
    }
    if (event.type === "activity") {
      set((state) => {
        if (!event.message) {
          return { activity: undefined, busy: state.snapshot?.isStreaming || state.snapshot?.isCompacting || Boolean(state.pendingUser) };
        }
        return {
          busy: true,
          activity: {
            message: polishActivity(event.message, lastTool.name, lastTool.args),
            startedAt: state.activity?.startedAt ?? Date.now(),
            elapsed: event.elapsed,
          },
        };
      });
      return;
    }
    if (event.type === "text_delta" && event.delta) {
      set((state) => ({
        streamingText: state.streamingText + event.delta,
        snapshot: state.snapshot
          ? { ...state.snapshot, isStreaming: true, messages: mergeAssistantDelta(state.snapshot.messages, "text", event.delta ?? "") }
          : state.snapshot,
        busy: true,
        activity: { message: "正在输出回复…", startedAt: state.activity?.startedAt ?? Date.now() },
      }));
      return;
    }
    if (event.type === "thinking_delta" && event.delta) {
      set((state) => ({
        streamingThinking: state.streamingThinking + event.delta,
        snapshot: state.snapshot
          ? {
              ...state.snapshot,
              isStreaming: true,
              messages: mergeAssistantDelta(state.snapshot.messages, "thinking", event.delta ?? ""),
            }
          : state.snapshot,
        busy: true,
        activity: { message: "正在思考…", startedAt: state.activity?.startedAt ?? Date.now() },
      }));
      return;
    }
    if (event.type === "tool_start") {
      lastTool = { name: event.toolName, args: event.args };
      const message = activityLabel(event.toolName, event.args);
      set((state) => ({
        busy: true,
        activity: { message, startedAt: state.activity?.startedAt ?? Date.now() },
        snapshot: state.snapshot
          ? { ...state.snapshot, isStreaming: true, messages: upsertToolCall(state.snapshot.messages, event.toolCallId, event.toolName, event.args) }
          : state.snapshot,
      }));
      return;
    }
    if (event.type === "tool_update") {
      lastTool = {
        name: event.toolName || lastTool.name,
        args: event.args !== undefined ? event.args : lastTool.args,
      };
      const message = activityLabel(lastTool.name, lastTool.args).replace(/…$/, "，请稍候…");
      set((state) => ({
        busy: true,
        activity: { message, startedAt: state.activity?.startedAt ?? Date.now() },
      }));
      return;
    }
    if (event.type === "tool_end") {
      set((state) => ({
        busy: true,
        activity: { message: "工具已完成，继续处理…", startedAt: state.activity?.startedAt ?? Date.now() },
      }));
      return;
    }
    if (event.type === "bash_delta") {
      const message = lastTool.name === "bash" ? activityLabel("bash", lastTool.args) : "正在运行命令…";
      set((state) => ({
        busy: true,
        activity: { message, startedAt: state.activity?.startedAt ?? Date.now() },
      }));
      return;
    }
    if (event.type === "gpa" && event.gpa) {
      set((state) => ({
        snapshot: state.snapshot ? { ...state.snapshot, gpa: event.gpa } : state.snapshot,
      }));
      return;
    }
    if (event.type === "watchdog" && event.watchdog) {
      const report = event.watchdog;
      set((state) => {
        if (!state.snapshot) return state;
        const reports = state.snapshot.watchdogReports ?? [];
        const index = reports.findIndex((item) => item.id === report.id);
        const next =
          index >= 0 ? reports.map((item, itemIndex) => (itemIndex === index ? report : item)) : [...reports, report];
        return { snapshot: { ...state.snapshot, watchdogReports: next.slice(-20) } };
      });
      return;
    }
    if (event.type === "queue_update") {
      set((state) => ({
        snapshot: state.snapshot
          ? { ...state.snapshot, queue: { steering: event.steering ?? [], followUp: event.followUp ?? [] } }
          : state.snapshot,
      }));
      return;
    }
    if (event.type === "toast" && event.message) {
      const id = toastId++;
      const type = event.toastType ?? "info";
      set((state) => ({ toasts: [...state.toasts, { id, type, message: event.message ?? "" }] }));
      scheduleToastDismiss(id, type);
    }
    if (event.type === "compaction") {
      set((state) => ({
        busy: true,
        activity: {
          message: event.reason === "compaction_end" ? "压缩完成，继续回复…" : "正在压缩上下文…",
          startedAt: state.activity?.startedAt ?? Date.now(),
        },
      }));
    }
  },
  setDialog: (dialog) => set({ dialog }),
  pushToast: (type, message) => {
    const id = toastId++;
    set((state) => {
      // 去重 + 上限 3 条：同一文案不堆叠，旧条目自动汰出（审计 S8-3）
      const others = state.toasts.filter((toast) => toast.message !== message);
      return { toasts: [...others, { id, type, message }].slice(-3) };
    });
    scheduleToastDismiss(id, type);
  },
  dismissToast: (id) => {
    const timer = toastTimers.get(id);
    if (timer) {
      clearTimeout(timer);
      toastTimers.delete(id);
    }
    set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) }));
  },
}));

export async function bootstrapApp(): Promise<void> {
  const state = await window.pi.getState();
  useAppStore.getState().applySnapshot(state);
  const [sessions, modelLists, settings, commands] = await Promise.all([
    window.pi.listSessions().catch(() => []),
    window.pi.listModels().catch(() => ({ models: [], providers: [] })),
    window.pi.getSettings().catch(() => ({})),
    window.pi.getCommands().catch(() => []),
  ]);
  const appVersion = await window.pi.getAppVersion().catch(() => "");
  useAppStore.setState({
    sessions,
    models: modelLists.models,
    providers: modelLists.providers,
    settings,
    commands,
    appVersion,
    bootstrapped: true,
  });
}

/**
 * 刷新会话列表（增量索引，开销很小）。
 *
 * 会话页、新会话、删除会话这些场景只影响列表，不需要连带重拉模型目录。
 */
export async function refreshSessions(): Promise<void> {
  const sessions = await window.pi.listSessions().catch(() => []);
  useAppStore.setState({ sessions });
}

/** 刷新模型目录 + 提供商 + 设置（改模型、登录、默认模型时用）。 */
export async function refreshModels(): Promise<void> {
  const [modelLists, settings] = await Promise.all([
    window.pi.listModels().catch(() => ({ models: [], providers: [] })),
    window.pi.getSettings().catch(() => ({})),
  ]);
  useAppStore.setState({
    models: modelLists.models,
    providers: modelLists.providers,
    settings,
  });
}

/** 刷新斜杠命令（安装/卸载扩展后）。 */
export async function refreshCommands(): Promise<void> {
  const commands = await window.pi.getCommands().catch(() => []);
  useAppStore.setState({ commands });
}

/** 全量刷新：切换项目、重载资源这类场景用。 */
export async function refreshModelsAndSessions(): Promise<void> {
  const [sessions, modelLists, settings, commands] = await Promise.all([
    window.pi.listSessions().catch(() => []),
    window.pi.listModels().catch(() => ({ models: [], providers: [] })),
    window.pi.getSettings().catch(() => ({})),
    window.pi.getCommands().catch(() => []),
  ]);
  useAppStore.setState({
    sessions,
    models: modelLists.models,
    providers: modelLists.providers,
    settings,
    commands,
  });
}
