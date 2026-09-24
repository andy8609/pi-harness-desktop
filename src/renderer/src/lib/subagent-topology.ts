import type { ChatMessage } from "@shared/types";
import { toolCalls } from "./text";

/**
 * Derive delegation/subagent activity from the transcript.
 *
 * pi has no built-in subagents; extensions such as `pi-subagent` register a
 * tool (commonly `Task`) whose calls and results appear in the normal message
 * stream. This module turns those calls into a reviewable list without
 * depending on any specific extension implementation.
 */

const DELEGATION_PATTERN = /(subagent|sub_agent|delegate|dispatch|spawn|\btask\b|\bagent\b)/i;

/** Built-in tools that never represent a delegation. */
const EXCLUDED = new Set(["read", "write", "edit", "bash", "powershell", "grep", "find", "ls", "glob"]);

export interface DelegationItem {
  id: string;
  name: string;
  label: string;
  args?: unknown;
  result?: unknown;
  isError?: boolean;
  status: "running" | "done" | "failed";
}

function describeArgs(args: unknown): string {
  if (!args || typeof args !== "object") return "";
  const obj = args as Record<string, unknown>;
  for (const key of ["description", "prompt", "task", "instruction", "query", "name", "goal"]) {
    const value = obj[key];
    if (typeof value === "string" && value.trim()) return value.trim().slice(0, 200);
  }
  return "";
}

export function isDelegationTool(name: string): boolean {
  const normalized = name.trim().toLowerCase();
  if (!normalized || EXCLUDED.has(normalized)) return false;
  return DELEGATION_PATTERN.test(normalized);
}

export function collectDelegations(messages: ChatMessage[]): DelegationItem[] {
  const results = new Map<string, ChatMessage>();
  for (const message of messages) {
    if (message.role === "toolResult" && message.toolCallId) results.set(message.toolCallId, message);
  }

  const items: DelegationItem[] = [];
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    for (const call of toolCalls(message.content)) {
      const name = String(call.name ?? "");
      if (!isDelegationTool(name)) continue;
      const result = call.id ? results.get(call.id) : undefined;
      const status: DelegationItem["status"] = result ? (result.isError ? "failed" : "done") : "running";
      items.push({
        id: call.id ?? `${name}-${items.length}`,
        name,
        label: describeArgs(call.arguments) || name,
        args: call.arguments,
        result: result ? { details: result.details, content: result.content } : undefined,
        isError: result?.isError,
        status,
      });
    }
  }
  return items;
}
