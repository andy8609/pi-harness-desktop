import type { ChatContentPart, ChatMessage } from "@shared/types";

export function contentText(content: ChatMessage["content"]): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (part.type === "text") return part.text ?? "";
      if (part.type === "thinking") return "";
      return "";
    })
    .join("");
}

export function thinkingText(content: ChatMessage["content"]): string {
  if (!Array.isArray(content)) return "";
  return content
    .filter((part) => part.type === "thinking" || part.thinking)
    .map((part) => part.thinking ?? part.text ?? "")
    .join("");
}

export function toolCalls(content: ChatMessage["content"]): ChatContentPart[] {
  if (!Array.isArray(content)) return [];
  return content.filter((part) => part.type === "toolCall" || part.type === "tool_call");
}

export function formatCost(cost: number): string {
  if (!cost) return "$0.00";
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(2)}`;
}

export function shortPath(path: string): string {
  if (!path) return "";
  const parts = path.replace(/\\/g, "/").split("/");
  return parts.slice(-2).join("/");
}

export function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes} 分 ${rest} 秒` : `${minutes} 分钟`;
}

export function formatTime(value?: string): string {
  if (!value) return "";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}
