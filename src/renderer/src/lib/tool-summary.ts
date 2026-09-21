export type ToolKind = "read" | "edit" | "write" | "bash" | "grep" | "find" | "ls" | "other";

export interface ToolSummary {
  kind: ToolKind;
  action: string;
  title: string;
  target?: string;
  extra?: string;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function displayToolPath(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length <= 3) return parts.join("/") || normalized;
  return parts.slice(-3).join("/");
}

export function toolPath(args: unknown): string {
  const record = asRecord(args);
  return str(record.path) || str(record.file_path) || str(record.filePath) || "";
}

export function toolKind(name?: string): ToolKind {
  const key = (name || "").toLowerCase();
  if (key === "read") return "read";
  if (key === "edit") return "edit";
  if (key === "write") return "write";
  if (key === "bash") return "bash";
  if (key === "grep") return "grep";
  if (key === "find") return "find";
  if (key === "ls") return "ls";
  return "other";
}

export function summarizeTool(name?: string, args?: unknown): ToolSummary {
  const kind = toolKind(name);
  const record = asRecord(args);
  const path = toolPath(args);
  const shown = path ? displayToolPath(path) : "";

  if (kind === "read") {
    const offset = record.offset != null ? String(record.offset) : "";
    const limit = record.limit != null ? String(record.limit) : "";
    const extra = offset || limit ? `第 ${offset || "1"} 行起${limit ? `，${limit} 行` : ""}` : undefined;
    return { kind, action: "读取", target: shown || path, extra, title: shown ? `读取 ${shown}${extra ? `（${extra}）` : ""}` : extra ? `读取文件（${extra}）` : "读取文件" };
  }
  if (kind === "edit") {
    const edits = Array.isArray(record.edits) ? record.edits.length : record.oldText != null || record.newText != null ? 1 : 0;
    const extra = edits > 0 ? `${edits} 处` : undefined;
    return {
      kind,
      action: "修改",
      target: shown || path,
      extra,
      title: shown ? `修改 ${shown}${edits ? `（${edits} 处）` : ""}` : "修改文件",
    };
  }
  if (kind === "write") {
    return { kind, action: "写入", target: shown || path, title: shown ? `写入 ${shown}` : "写入文件" };
  }
  if (kind === "bash") {
    const command = str(record.command).replace(/\s+/g, " ");
    const short = command.length > 80 ? `${command.slice(0, 80)}…` : command;
    return { kind, action: "运行", extra: short, title: short ? `运行 ${short}` : "运行命令" };
  }
  if (kind === "grep") {
    const pattern = str(record.pattern) || str(record.query);
    const where = [shown, str(record.glob)].filter(Boolean).join(" · ");
    return {
      kind,
      action: "搜索",
      target: shown || path,
      extra: pattern,
      title: pattern ? `搜索 ${pattern}${where ? ` · ${where}` : ""}` : "搜索代码",
    };
  }
  if (kind === "find") {
    const pattern = str(record.pattern) || str(record.glob);
    return {
      kind,
      action: "查找",
      target: shown || path,
      extra: pattern,
      title: pattern ? `查找 ${pattern}${shown ? ` · ${shown}` : ""}` : shown ? `查找 ${shown}` : "查找文件",
    };
  }
  if (kind === "ls") {
    return { kind, action: "列出", target: shown || path || ".", title: `列出 ${shown || path || "当前目录"}` };
  }
  return { kind, action: "调用", extra: name, title: name ? `调用 ${name}` : "调用工具" };
}

export function activityLabel(name?: string, args?: unknown): string {
  const summary = summarizeTool(name, args);
  return `正在${summary.title}…`;
}

function clipLines(text: string, maxLines: number): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  if (lines.length <= maxLines) return text;
  return `${lines.slice(0, maxLines).join("\n")}\n…（共 ${lines.length} 行）`;
}

export function extractText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object" && "text" in item) return String((item as { text?: string }).text ?? "");
        return "";
      })
      .join("");
  }
  const record = asRecord(value);
  if (record.content !== undefined) {
    const nested = extractText(record.content);
    if (nested) return nested;
  }
  if (typeof record.text === "string") return record.text;
  if (typeof record.output === "string") return record.output;
  const meta = new Set([
    "diff",
    "patch",
    "firstChangedLine",
    "truncation",
    "fullOutputPath",
    "entryLimitReached",
    "matchLimitReached",
    "linesTruncated",
    "details",
  ]);
  const rest = Object.fromEntries(Object.entries(record).filter(([key]) => !meta.has(key)));
  if (Object.keys(rest).length === 0) return "";
  try {
    return JSON.stringify(rest, null, 2);
  } catch {
    return String(value);
  }
}

export function extractDiff(value: unknown): string {
  const record = asRecord(value);
  if (typeof record.diff === "string") return record.diff;
  if (typeof record.patch === "string") return record.patch;
  const nested = record.details;
  if (nested && typeof nested === "object") {
    const details = asRecord(nested);
    if (typeof details.diff === "string") return details.diff;
    if (typeof details.patch === "string") return details.patch;
  }
  return "";
}

export function previewText(value: unknown, maxLines = 40): string {
  return clipLines(extractText(value).trim(), maxLines);
}

export function writeContent(args: unknown): string {
  return str(asRecord(args).content);
}

export function bashCommand(args: unknown): string {
  return str(asRecord(args).command);
}

export interface TurnOperationSummary {
  reads: string[];
  writes: string[];
  commands: string[];
}

export function summarizeTurn(tools: Array<{ name?: string; arguments?: unknown }>): TurnOperationSummary {
  const reads: string[] = [];
  const writes: string[] = [];
  const commands: string[] = [];
  const seen = new Set<string>();
  const push = (list: string[], value: string) => {
    if (!value || seen.has(`${list === reads ? "r" : list === writes ? "w" : "c"}:${value}`)) return;
    seen.add(`${list === reads ? "r" : list === writes ? "w" : "c"}:${value}`);
    list.push(value);
  };

  for (const tool of tools) {
    const summary = summarizeTool(tool.name, tool.arguments);
    if (summary.kind === "read" || summary.kind === "ls") {
      push(reads, summary.target || "");
    } else if ((summary.kind === "grep" || summary.kind === "find") && summary.target) {
      push(reads, summary.target);
    } else if (summary.kind === "edit" || summary.kind === "write") {
      push(writes, summary.target || "");
    } else if (summary.kind === "bash") {
      push(commands, summary.extra || "");
    }
  }
  return { reads, writes, commands };
}

export function polishActivity(message: string, name?: string, args?: unknown): string {
  const match = /^(正在执行 )(.+?)(，请稍候)?…$/.exec(message);
  if (!match) return message;
  const fromMessage = match[2] === "工具" ? undefined : match[2];
  const toolName = fromMessage || (name && name !== "工具" ? name : undefined);
  const useArgs = !fromMessage || !name || fromMessage === name ? args : undefined;
  const label = activityLabel(toolName, useArgs);
  return match[3] ? label.replace(/…$/, "，请稍候…") : label;
}
