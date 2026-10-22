import { ArrowDown, Copy, PencilSimple, TerminalWindow } from "@phosphor-icons/react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ChatMessage } from "@shared/types";
import { useFollowScroll } from "../hooks/useFollowScroll";
import { contentText, thinkingText, toolCalls } from "../lib/text";
import { summarizeTurn, type TurnOperationSummary } from "../lib/tool-summary";
import { useAppStore } from "../stores/app-store";
import { ToolActivityGroup, type ToolEntry } from "./ToolActivityGroup";
import { ToolCallCard } from "./ToolCallCard";
import { WatchdogFeed } from "./SubagentPanel";
import { WorkingIndicator } from "./WorkingIndicator";

function joinList(items: string[], limit = 8): string {
  if (items.length <= limit) return items.join(", ");
  return `${items.slice(0, limit).join(", ")} 等 ${items.length} 个`;
}

function TurnFileSummary({ summary }: { summary: TurnOperationSummary }) {
  if (summary.reads.length === 0 && summary.writes.length === 0 && summary.commands.length === 0) return null;
  return (
    <div className="mt-2 space-y-0.5 rounded-lg border border-[var(--line)] bg-[var(--bg-code)] px-3 py-2 text-[11px] leading-5 text-[var(--muted)]">
      {summary.reads.length > 0 && <div>读取：{joinList(summary.reads)}</div>}
      {summary.writes.length > 0 && <div>修改/写入：{joinList(summary.writes)}</div>}
      {summary.commands.length > 0 && <div>运行：{joinList(summary.commands)}</div>}
    </div>
  );
}

function MessageBody({
  message,
  toolResults = [],
  streaming,
}: {
  message: ChatMessage;
  toolResults?: ChatMessage[];
  streaming?: boolean;
}) {
  const hideThinking = useAppStore((state) => state.settings.hideThinkingBlock);
  if (message.role === "custom") {
    const text = typeof message.content === "string" ? message.content : contentText(message.content);
    return (
      <details className="rounded-lg border border-[var(--line)] bg-[var(--bg-panel)] px-3 py-2 text-sm text-[var(--muted)]">
        <summary className="cursor-pointer text-[var(--accent)]">{message.customType || "custom"}</summary>
        <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap text-[12px]">{text}</pre>
      </details>
    );
  }
  if (message.role === "compactionSummary") {
    return (
      <details className="rounded-lg border border-[var(--line)] bg-[var(--bg-panel)] px-3 py-2 text-sm text-[var(--muted)]">
        <summary className="cursor-pointer text-[var(--accent)]">上下文压缩摘要</summary>
        <div className="mt-2 whitespace-pre-wrap">
          {typeof message.content === "string" ? message.content : contentText(message.content)}
        </div>
      </details>
    );
  }
  if (message.role === "branchSummary") {
    return (
      <details className="rounded-lg border border-[var(--line)] bg-[var(--bg-panel)] px-3 py-2 text-sm text-[var(--muted)]">
        <summary className="cursor-pointer text-[var(--accent)]">分支摘要</summary>
        <div className="mt-2 whitespace-pre-wrap">
          {typeof message.content === "string" ? message.content : contentText(message.content)}
        </div>
      </details>
    );
  }
  if (message.role === "toolResult") {
    return (
      <ToolCallCard
        name={message.toolName}
        result={{ details: message.details, content: message.content }}
        isError={message.isError}
      />
    );
  }
  if (message.role === "bashExecution") {
    return (
      <div className="rounded-lg border border-[var(--line)] bg-[var(--bg-code)] px-3 py-2 text-sm">
        <div className="mb-1 flex items-center gap-2 text-[var(--accent)]">
          <TerminalWindow size={14} />
          <code>{message.command}</code>
          <span className="text-[var(--muted)]">exit {message.exitCode ?? "?"}</span>
        </div>
        <pre className="max-h-64 overflow-auto text-[12px] text-[var(--text)]">{message.output}</pre>
      </div>
    );
  }
  const thinking = thinkingText(message.content);
  const text = contentText(message.content);
  const tools = toolCalls(message.content);
  const resultById = new Map(toolResults.map((item) => [item.toolCallId, item]));
  const unmatched = toolResults.filter(
    (item) => !item.toolCallId || !tools.some((tool) => tool.id === item.toolCallId),
  );
  const turn = summarizeTurn([
    ...tools.map((tool) => ({ name: tool.name, arguments: tool.arguments })),
    ...unmatched.map((item) => ({ name: item.toolName })),
  ]);
  const toolEntries: ToolEntry[] = [
    ...tools.map((tool) => {
      const result = tool.id ? resultById.get(tool.id) : undefined;
      return {
        id: tool.id ?? tool.name ?? "tool",
        name: tool.name,
        args: tool.arguments,
        result: result ? { details: result.details, content: result.content } : undefined,
        isError: result?.isError,
      };
    }),
    ...unmatched.map((result, index) => ({
      id: result.toolCallId ?? `tool-result-${index}`,
      name: result.toolName,
      result: { details: result.details, content: result.content },
      isError: result.isError,
    })),
  ];
  return (
    <div>
      {!hideThinking && thinking && (
        <details
          className="mb-2 rounded-lg border border-[var(--line)] bg-[var(--bg-panel)] px-3 py-2 text-xs text-[var(--muted)]"
          open={streaming ? true : undefined}
        >
          <summary className="cursor-pointer text-[var(--accent)]">思考过程</summary>
          <div className="mt-2 whitespace-pre-wrap">{thinking}</div>
        </details>
      )}
      {text && (
        <div className="markdown-body text-sm leading-6">
          <Markdown remarkPlugins={[remarkGfm]}>{text}</Markdown>
        </div>
      )}
      {(tools.length > 0 || unmatched.length > 0) && <TurnFileSummary summary={turn} />}
      <ToolActivityGroup tools={toolEntries} running={streaming} />
      {message.errorMessage && <div className="mt-2 text-sm text-[var(--danger)]">{message.errorMessage}</div>}
    </div>
  );
}

type DisplayItem = { message: ChatMessage; toolResults: ChatMessage[] };

function groupMessages(messages: ChatMessage[]): DisplayItem[] {
  const items: DisplayItem[] = [];
  let index = 0;
  while (index < messages.length) {
    const message = messages[index];
    if (message.role === "assistant") {
      const toolResults: ChatMessage[] = [];
      index += 1;
      while (index < messages.length && messages[index].role === "toolResult") {
        toolResults.push(messages[index]);
        index += 1;
      }
      items.push({ message, toolResults });
      continue;
    }
    items.push({ message, toolResults: [] });
    index += 1;
  }
  return items;
}

function IconAction({
  title,
  onClick,
  children,
}: {
  title: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      className="rounded-md border border-transparent p-1 text-[var(--muted)] hover:border-[var(--line)] hover:text-[var(--text)]"
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
      <div className="text-base font-medium text-[var(--text)]">开始一段新对话</div>
      <div className="max-w-md text-sm leading-6 text-[var(--muted)]">
        在下方输入消息开始。使用 <code className="text-[var(--accent)]">/</code> 触发命令，
        <code className="text-[var(--accent)]">@</code> 引用项目文件，
        <code className="text-[var(--accent)]">!</code> 运行 bash。
        <br />
        若模型列表为空，请先到「模型」页配置自定义提供商。
      </div>
    </div>
  );
}

export function MessageList({ messages }: { messages: ChatMessage[] }) {
  const busy = useAppStore((state) => state.busy);
  const pushToast = useAppStore((state) => state.pushToast);
  const items = useMemo(() => groupMessages(messages), [messages]);
  const { scrollRef, showJump, handleScroll, jumpToLatest, scheduleFollowScroll } = useFollowScroll<HTMLDivElement>();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    scheduleFollowScroll();
  }, [messages, busy, scheduleFollowScroll]);

  const copyText = async (text: string) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      pushToast("info", "已复制");
    } catch {
      pushToast("error", "复制失败");
    }
  };

  const startEdit = (message: ChatMessage) => {
    if (!message.entryId) return;
    setEditingId(message.entryId);
    setEditValue(contentText(message.content));
  };

  const saveEdit = async (message: ChatMessage) => {
    if (!message.entryId || saving) return;
    const value = editValue.trim();
    if (!value) return;
    setSaving(true);
    try {
      await window.pi.editUserMessage(message.entryId, { text: value });
      setEditingId(null);
    } catch (error) {
      pushToast("error", error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  if (messages.length === 0 && !busy) {
    return <EmptyState />;
  }

  return (
    <div className="relative h-full min-h-0">
      <div ref={scrollRef} onScroll={handleScroll} className="h-full overflow-auto px-6 py-4">
        <div className="mx-auto max-w-5xl space-y-5">
          {items.map((item, index) => {
            const isUser = item.message.role === "user";
            const streaming = busy && index === items.length - 1 && item.message.role === "assistant";
            const editing = Boolean(item.message.entryId) && editingId === item.message.entryId;
            const text = contentText(item.message.content);
            return (
              <article
                key={`${item.message.role}-${index}-${item.message.entryId ?? item.message.timestamp ?? ""}`}
                className={`group flex flex-col ${isUser ? "items-end" : "items-start"}`}
              >
                <div
                  className={
                    isUser
                      ? "max-w-[85%] rounded-2xl border border-[var(--line)] bg-[var(--user-bubble)] px-3.5 py-2.5"
                      : "w-full"
                  }
                >
                  {isUser ? (
                    editing ? (
                      <div className="w-[min(560px,70vw)]">
                        <textarea
                          autoFocus
                          rows={Math.min(12, Math.max(3, editValue.split("\n").length))}
                          className="w-full resize-none rounded-lg border border-[var(--line)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)]"
                          value={editValue}
                          disabled={saving}
                          onChange={(event) => setEditValue(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Escape") setEditingId(null);
                            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                              event.preventDefault();
                              void saveEdit(item.message);
                            }
                          }}
                        />
                        <div className="mt-2 flex justify-end gap-2">
                          <button
                            type="button"
                            className="rounded-lg border border-[var(--line)] px-3 py-1 text-xs"
                            disabled={saving}
                            onClick={() => setEditingId(null)}
                          >
                            取消
                          </button>
                          <button
                            type="button"
                            className="rounded-lg bg-[var(--accent)] px-3 py-1 text-xs text-[#16180f] disabled:opacity-50"
                            disabled={saving || !editValue.trim()}
                            onClick={() => void saveEdit(item.message)}
                          >
                            {saving ? "重发中…" : "保存并重发"}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="whitespace-pre-wrap text-sm text-[var(--text)]">{text}</div>
                    )
                  ) : (
                    <MessageBody message={item.message} toolResults={item.toolResults} streaming={streaming} />
                  )}
                </div>
                {!editing && (
                  <div className="mt-1 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                    {text && (
                      <IconAction title="复制" onClick={() => void copyText(text)}>
                        <Copy size={13} />
                      </IconAction>
                    )}
                    {isUser && item.message.entryId && (
                      <IconAction title="编辑并重发" onClick={() => startEdit(item.message)}>
                        <PencilSimple size={13} />
                      </IconAction>
                    )}
                  </div>
                )}
              </article>
            );
          })}
          <WatchdogFeed className="mt-3" />
          <WorkingIndicator />
        </div>
      </div>
      {showJump && (
        <button
          type="button"
          title="回到最新"
          aria-label="回到最新"
          className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full border border-[var(--line)] bg-[var(--bg-panel)] p-2 text-[var(--text)] shadow-lg hover:border-[var(--accent)]"
          onClick={jumpToLatest}
        >
          <ArrowDown size={16} />
        </button>
      )}
    </div>
  );
}
