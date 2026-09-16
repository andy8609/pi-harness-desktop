import { CaretDown, CaretRight, TerminalWindow, Wrench } from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ChatMessage } from "@shared/types";
import { contentText, thinkingText, toolCalls } from "../lib/text";
import { useAppStore } from "../stores/app-store";
import { WorkingIndicator } from "./WorkingIndicator";

function formatToolValue(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function ToolCard({
  name,
  args,
  result,
  isError,
  running,
}: {
  name?: string;
  args?: unknown;
  result?: unknown;
  isError?: boolean;
  running?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const payload: Record<string, unknown> = {};
  if (args !== undefined) payload.args = args;
  if (result !== undefined) payload.result = result;
  const body = Object.keys(payload).length > 0 ? formatToolValue(payload) : "";
  return (
    <div className={`mt-2 rounded-lg border ${isError ? "border-[#e07a5f]" : "border-[#33392a]"} bg-[#10130d]`}>
      <button className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-[#c4d45a]" onClick={() => setOpen((v) => !v)}>
        {open ? <CaretDown size={12} /> : <CaretRight size={12} />}
        {running && result === undefined && (
          <span className="inline-block h-3 w-3 animate-spin rounded-full border border-[#c4d45a] border-t-transparent" />
        )}
        <Wrench size={12} />
        <span>{name || "tool"}</span>
        {result !== undefined ? (
          <span className="text-[#9a937c]">{isError ? "失败" : "完成"}</span>
        ) : running ? (
          <span className="text-[#9a937c]">进行中</span>
        ) : null}
      </button>
      {open && body && (
        <pre className="max-h-72 overflow-auto border-t border-[#33392a] px-3 py-2 text-[11px] text-[#ece7d5]">{body}</pre>
      )}
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
  if (message.role === "user") {
    return <div className="whitespace-pre-wrap text-[#ece7d5]">{contentText(message.content)}</div>;
  }
  if (message.role === "custom") {
    const text = typeof message.content === "string" ? message.content : contentText(message.content);
    return (
      <details className="rounded-lg border border-[#33392a] bg-[#1a1d16] px-3 py-2 text-sm text-[#cfc8b0]">
        <summary className="cursor-pointer text-[#c4d45a]">{message.customType || "custom"}</summary>
        <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap text-[12px]">{text}</pre>
      </details>
    );
  }
  if (message.role === "compactionSummary") {
    return (
      <details className="rounded-lg border border-[#33392a] bg-[#1a1d16] px-3 py-2 text-sm text-[#cfc8b0]">
        <summary className="cursor-pointer text-[#c4d45a]">上下文压缩摘要</summary>
        <div className="mt-2 whitespace-pre-wrap">{typeof message.content === "string" ? message.content : contentText(message.content)}</div>
      </details>
    );
  }
  if (message.role === "branchSummary") {
    return (
      <details className="rounded-lg border border-[#33392a] bg-[#1a1d16] px-3 py-2 text-sm text-[#cfc8b0]">
        <summary className="cursor-pointer text-[#c4d45a]">分支摘要</summary>
        <div className="mt-2 whitespace-pre-wrap">{typeof message.content === "string" ? message.content : contentText(message.content)}</div>
      </details>
    );
  }
  if (message.role === "toolResult") {
    return (
      <ToolCard
        name={message.toolName}
        args={undefined}
        result={message.details ?? message.content}
        isError={message.isError}
      />
    );
  }
  if (message.role === "bashExecution") {
    return (
      <div className="rounded-lg border border-[#33392a] bg-[#10130d] px-3 py-2 text-sm">
        <div className="mb-1 flex items-center gap-2 text-[#c4d45a]">
          <TerminalWindow size={14} />
          <code>{message.command}</code>
          <span className="text-[#9a937c]">exit {message.exitCode ?? "?"}</span>
        </div>
        <pre className="max-h-64 overflow-auto text-[12px] text-[#ece7d5]">{message.output}</pre>
      </div>
    );
  }
  const thinking = thinkingText(message.content);
  const text = contentText(message.content);
  const tools = toolCalls(message.content);
  const resultById = new Map(toolResults.map((item) => [item.toolCallId, item]));
  const unmatched = toolResults.filter((item) => !item.toolCallId || !tools.some((tool) => tool.id === item.toolCallId));
  return (
    <div>
      {!hideThinking && thinking && (
        <details
          className="mb-2 rounded-lg border border-[#33392a] bg-[#1a1d16] px-3 py-2 text-xs text-[#9a937c]"
          open={streaming ? true : undefined}
        >
          <summary className="cursor-pointer text-[#c4d45a]">思考过程</summary>
          <div className="mt-2 whitespace-pre-wrap">{thinking}</div>
        </details>
      )}
      {text && (
        <div className="markdown-body text-sm leading-6">
          <Markdown remarkPlugins={[remarkGfm]}>{text}</Markdown>
        </div>
      )}
      {tools.map((tool) => {
        const result = tool.id ? resultById.get(tool.id) : undefined;
        return (
          <ToolCard
            key={tool.id ?? tool.name}
            name={tool.name}
            args={tool.arguments}
            result={result ? (result.details ?? result.content) : undefined}
            isError={result?.isError}
            running={streaming}
          />
        );
      })}
      {unmatched.map((result, index) => (
        <ToolCard
          key={result.toolCallId ?? `tool-result-${index}`}
          name={result.toolName}
          result={result.details ?? result.content}
          isError={result.isError}
        />
      ))}
      {message.errorMessage && <div className="mt-2 text-sm text-[#e07a5f]">{message.errorMessage}</div>}
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

export function MessageList({ messages }: { messages: ChatMessage[] }) {
  const endRef = useRef<HTMLDivElement>(null);
  const busy = useAppStore((state) => state.busy);
  const items = useMemo(() => groupMessages(messages), [messages]);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, busy]);

  if (messages.length === 0 && !busy) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-[#9a937c]">
        发送一条消息，或先到「模型」页配置自定义提供商。
      </div>
    );
  }
  return (
    <div className="space-y-4">
      {items.map((item, index) => {
        const streaming = busy && index === items.length - 1 && item.message.role === "assistant";
        return (
          <article
            key={`${item.message.role}-${index}-${item.message.timestamp ?? ""}`}
            className={`rounded-xl px-4 py-3 ${item.message.role === "user" ? "bg-[#22261c]" : "bg-transparent"}`}
          >
            <div className="mb-1 text-[11px] uppercase tracking-[0.14em] text-[#9a937c]">{item.message.role}</div>
            <MessageBody message={item.message} toolResults={item.toolResults} streaming={streaming} />
          </article>
        );
      })}
      <WorkingIndicator />
      <div ref={endRef} />
    </div>
  );
}
