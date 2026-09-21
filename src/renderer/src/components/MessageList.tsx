import { TerminalWindow } from "@phosphor-icons/react";
import { useEffect, useMemo, useRef } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ChatMessage } from "@shared/types";
import { contentText, thinkingText, toolCalls } from "../lib/text";
import { summarizeTurn, type TurnOperationSummary } from "../lib/tool-summary";
import { useAppStore } from "../stores/app-store";
import { ToolCallCard } from "./ToolCallCard";
import { WorkingIndicator } from "./WorkingIndicator";

function joinList(items: string[], limit = 8): string {
  if (items.length <= limit) return items.join(", ");
  return `${items.slice(0, limit).join(", ")} 等 ${items.length} 个`;
}

function TurnFileSummary({ summary }: { summary: TurnOperationSummary }) {
  if (summary.reads.length === 0 && summary.writes.length === 0 && summary.commands.length === 0) return null;
  return (
    <div className="mt-2 space-y-0.5 rounded-lg border border-[#2a2f22] bg-[#161910] px-3 py-2 text-[11px] leading-5 text-[#9a937c]">
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
    return <ToolCallCard name={message.toolName} result={{ details: message.details, content: message.content }} isError={message.isError} />;
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
  const turn = summarizeTurn([
    ...tools.map((tool) => ({ name: tool.name, arguments: tool.arguments })),
    ...unmatched.map((item) => ({ name: item.toolName })),
  ]);
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
      {(tools.length > 0 || unmatched.length > 0) && <TurnFileSummary summary={turn} />}
      {tools.map((tool) => {
        const result = tool.id ? resultById.get(tool.id) : undefined;
        return (
          <ToolCallCard
            key={tool.id ?? tool.name}
            name={tool.name}
            args={tool.arguments}
            result={result ? { details: result.details, content: result.content } : undefined}
            isError={result?.isError}
            running={streaming}
          />
        );
      })}
      {unmatched.map((result, index) => (
        <ToolCallCard
          key={result.toolCallId ?? `tool-result-${index}`}
          name={result.toolName}
          result={{ details: result.details, content: result.content }}
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
