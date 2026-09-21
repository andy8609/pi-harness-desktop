import { CaretDown, CaretRight, FileText, FloppyDisk, FolderOpen, MagnifyingGlass, PencilSimple, TerminalWindow, Wrench } from "@phosphor-icons/react";
import { useState, type ReactNode } from "react";
import { bashCommand, extractDiff, previewText, summarizeTool, writeContent, type ToolKind } from "../lib/tool-summary";

function kindIcon(kind: ToolKind): ReactNode {
  const props = { size: 13, className: "shrink-0" };
  if (kind === "read") return <FileText {...props} />;
  if (kind === "edit") return <PencilSimple {...props} />;
  if (kind === "write") return <FloppyDisk {...props} />;
  if (kind === "bash") return <TerminalWindow {...props} />;
  if (kind === "grep" || kind === "find") return <MagnifyingGlass {...props} />;
  if (kind === "ls") return <FolderOpen {...props} />;
  return <Wrench {...props} />;
}

function DiffView({ diff }: { diff: string }) {
  const lines = diff.replace(/\r\n/g, "\n").split("\n");
  return (
    <pre className="max-h-72 overflow-auto border-t border-[#33392a] px-3 py-2 text-[11px] leading-5">
      {lines.map((line, index) => {
        const color =
          line.startsWith("+") && !line.startsWith("+++")
            ? "text-[#8fbf5a]"
            : line.startsWith("-") && !line.startsWith("---")
              ? "text-[#e07a5f]"
              : line.startsWith("@@")
                ? "text-[#7eb8c9]"
                : "text-[#ece7d5]";
        return (
          <div key={`${index}-${line.slice(0, 24)}`} className={color}>
            {line || " "}
          </div>
        );
      })}
    </pre>
  );
}

function PreviewBlock({ text, tone }: { text: string; tone?: "error" | "muted" }) {
  if (!text) return null;
  const color = tone === "error" ? "text-[#e07a5f]" : tone === "muted" ? "text-[#cfc8b0]" : "text-[#ece7d5]";
  return <pre className={`max-h-72 overflow-auto border-t border-[#33392a] px-3 py-2 text-[11px] leading-5 ${color}`}>{text}</pre>;
}

function readableFallback(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function ToolCallCard({
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
  const summary = summarizeTool(name, args);
  const pending = running && result === undefined;
  const diff = extractDiff(result);
  const command = bashCommand(args);
  const written = writeContent(args);
  const resultText = previewText(result, 40);

  let body: ReactNode = null;
  if (open) {
    if (summary.kind === "edit" && diff) {
      body = <DiffView diff={diff} />;
    } else if (summary.kind === "write") {
      body = (
        <>
          {written ? <PreviewBlock text={previewText(written, 40)} tone="muted" /> : null}
          {resultText ? <PreviewBlock text={resultText} tone={isError ? "error" : undefined} /> : null}
        </>
      );
    } else if (summary.kind === "bash") {
      body = (
        <>
          {command ? (
            <div className="border-t border-[#33392a] px-3 py-2 font-mono text-[11px] text-[#c4d45a]">{command}</div>
          ) : null}
          <PreviewBlock text={resultText} tone={isError ? "error" : undefined} />
        </>
      );
    } else if (summary.kind === "read" || summary.kind === "grep" || summary.kind === "ls" || summary.kind === "find") {
      body = <PreviewBlock text={resultText} tone={isError ? "error" : undefined} />;
    } else {
      const extras: string[] = [];
      if (args !== undefined) extras.push(readableFallback(args));
      if (result !== undefined && !resultText) extras.push(readableFallback(result));
      body = (
        <>
          {resultText ? <PreviewBlock text={resultText} tone={isError ? "error" : undefined} /> : null}
          {!resultText && extras.length > 0 ? <PreviewBlock text={extras.join("\n\n")} tone="muted" /> : null}
        </>
      );
    }
    if (!body) body = result !== undefined || args !== undefined ? <PreviewBlock text={resultText || readableFallback({ args, result })} tone="muted" /> : null;
  }

  return (
    <div className={`mt-2 rounded-lg border ${isError ? "border-[#e07a5f]" : "border-[#33392a]"} bg-[#10130d]`}>
      <button className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-[#c4d45a]" onClick={() => setOpen((value) => !value)}>
        {open ? <CaretDown size={12} className="shrink-0" /> : <CaretRight size={12} className="shrink-0" />}
        {pending && <span className="inline-block h-3 w-3 shrink-0 animate-spin rounded-full border border-[#c4d45a] border-t-transparent" />}
        {kindIcon(summary.kind)}
        <span className="min-w-0 flex-1 truncate">{summary.title}</span>
        {result !== undefined ? (
          <span className="shrink-0 text-[#9a937c]">{isError ? "失败" : "完成"}</span>
        ) : pending ? (
          <span className="shrink-0 text-[#9a937c]">进行中</span>
        ) : null}
      </button>
      {body}
    </div>
  );
}
