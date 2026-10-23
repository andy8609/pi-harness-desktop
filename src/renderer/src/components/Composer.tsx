import {
  CaretRight,
  CheckCircle,
  File,
  FileText,
  Image,
  Plus,
  ShieldCheck,
  Sparkle,
  Stop,
  PaperPlaneTilt,
  X,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import type { FileSearchResult, PromptImage, SlashCommand } from "@shared/types";
import type { GpaStage } from "@shared/gpa";
import { ModelPicker } from "./ModelPicker";
import { PlanTimeline } from "./PlanTimeline";
import { SkillPicker } from "./SkillPicker";
import { refreshModelsAndSessions, useAppStore } from "../stores/app-store";

const GPA_STAGE_LABEL: Record<GpaStage, string> = {
  off: "关闭",
  goal: "目标 GOAL",
  plan: "计划 PLAN",
  act: "执行 ACT",
};

/** 文本类文档的大小上限（超过则拒绝，避免上下文被大文件占满） */
const MAX_DOC_BYTES = 2 * 1024 * 1024;

/** 待发送的文本类文档附件（内容随消息内联，格式与 pi CLI 的 @文件 一致） */
interface DocAttachment {
  name: string;
  content: string;
}

export function Composer() {
  const [images, setImages] = useState<PromptImage[]>([]);
  const [docs, setDocs] = useState<DocAttachment[]>([]);
  const [files, setFiles] = useState<FileSearchResult[]>([]);
  const [preview, setPreview] = useState<PromptImage | null>(null);
  const [previewDoc, setPreviewDoc] = useState<DocAttachment | null>(null);
  const snapshot = useAppStore((state) => state.snapshot);
  const commands = useAppStore((state) => state.commands);
  const applySnapshot = useAppStore((state) => state.applySnapshot);
  const pushToast = useAppStore((state) => state.pushToast);
  const setView = useAppStore((state) => state.setView);
  const busy = useAppStore((state) => state.busy);
  const sessionId = snapshot?.sessionId ?? "";
  const text = useAppStore((state) => (sessionId ? state.composerDrafts[sessionId] ?? "" : ""));
  const setComposerDraft = useAppStore((state) => state.setComposerDraft);
  const setText = (value: string | ((current: string) => string)) => {
    if (!sessionId) return;
    const current = useAppStore.getState().composerDrafts[sessionId] ?? "";
    setComposerDraft(sessionId, typeof value === "function" ? value(current) : value);
  };
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const sendingRef = useRef(false);
  const plusRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [plusOpen, setPlusOpen] = useState(false);
  const [skillsOpen, setSkillsOpen] = useState(false);
  const gpa = snapshot?.gpa;
  const gpaEnabled = Boolean(gpa && gpa.stage !== "off");
  const fullTrust = Boolean(snapshot?.fullTrust);
  const setDialog = useAppStore((state) => state.setDialog);

  const slashQuery = text.startsWith("/") ? text.slice(1).split(/\s/)[0] : "";
  const filteredCommands = useMemo(
    () => (text.startsWith("/") ? commands.filter((command) => command.name.includes(slashQuery)).slice(0, 8) : []),
    [commands, slashQuery, text],
  );

  const atMatch = text.match(/(?:^|\s)@([^\s]*)$/);
  useEffect(() => {
    if (!atMatch) {
      setFiles([]);
      return;
    }
    const handle = window.setTimeout(() => {
      void window.pi.searchFiles(atMatch[1] ?? "").then(setFiles);
    }, 80);
    return () => window.clearTimeout(handle);
  }, [atMatch?.[1], text]);

  // 消费工作区右键"添加为引用"产生的引用队列：以 @路径 形式追加到输入框末尾。
  const referenceQueue = useAppStore((state) => state.referenceQueue);
  useEffect(() => {
    if (referenceQueue.length === 0) return;
    const insert = referenceQueue.map((path) => `@${path}`).join(" ");
    setText((current) => {
      const base = current === "" || current.endsWith(" ") ? current : `${current} `;
      return `${base}${insert} `;
    });
    useAppStore.setState({ referenceQueue: [] });
    textareaRef.current?.focus();
  }, [referenceQueue]);

  useEffect(() => {
    if (!plusOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!plusRef.current?.contains(event.target as Node)) {
        setPlusOpen(false);
        setSkillsOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      if (skillsOpen) setSkillsOpen(false);
      else setPlusOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [plusOpen, skillsOpen]);

  const runBuiltin = async (command: SlashCommand, rest: string) => {
    if (command.source !== "builtin") return false;
    switch (command.name) {
      case "new":
        applySnapshot(await window.pi.newSession());
        await refreshModelsAndSessions();
        return true;
      case "settings":
        setView("settings");
        return true;
      case "model":
        setView("models");
        return true;
      case "resume":
        setView("sessions");
        return true;
      case "tree":
        setView("sessions");
        return true;
      case "login":
        pushToast("info", "桌面端已去掉内置登录页。请使用 CLI 的 pi login，或在模型页添加自定义提供商。");
        return true;
      case "compact":
        await window.pi.compact(rest || undefined);
        return true;
      case "reload":
        await window.pi.reload();
        await refreshModelsAndSessions();
        return true;
      case "clone":
        applySnapshot(await window.pi.clone());
        await refreshModelsAndSessions();
        return true;
      case "name":
        if (rest) await window.pi.nameSession(rest);
        return true;
      case "export":
        await window.pi.exportHtml();
        return true;
      case "import":
        applySnapshot(await window.pi.importJsonl());
        return true;
      case "quit":
        await window.pi.quit();
        return true;
      default:
        return false;
    }
  };

  // 选中技能后把 /skill:<名称> 命令追加到输入框，用户可补充参数后发送
  const insertSkill = (name: string) => {
    setText((current) => {
      const base = current === "" || current.endsWith(" ") ? current : `${current} `;
      return `${base}/skill:${name} `;
    });
    textareaRef.current?.focus();
  };

  // 选择文件后分流：图片转为 base64 附件；文本类文档读取内容，发送时随消息内联
  const addAttachment = async (file: File) => {
    if (file.type.startsWith("image/")) {
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result ?? "");
        const data = result.split(",")[1] ?? "";
        setImages((current) => [...current, { type: "image", data, mimeType: file.type }]);
      };
      reader.readAsDataURL(file);
      return;
    }
    if (file.size > MAX_DOC_BYTES) {
      pushToast("error", `${file.name} 超过 2MB，暂不支持`);
      return;
    }
    try {
      const buffer = await file.arrayBuffer();
      // 前 8KB 含空字节视为二进制（PDF/Office 等），暂不支持
      if (new Uint8Array(buffer.slice(0, 8192)).includes(0)) {
        pushToast("error", `${file.name} 不是文本文件（PDF/Office 等二进制文档暂不支持）`);
        return;
      }
      const content = new TextDecoder("utf-8").decode(buffer).replace(/^\uFEFF/, "");
      if (!content.trim()) {
        pushToast("info", `${file.name} 是空文件，已跳过`);
        return;
      }
      setDocs((current) => [...current, { name: file.name, content }]);
    } catch (error) {
      pushToast("error", `${file.name} 读取失败：${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const submit = async () => {
    const value = text.trim();
    if (!value && images.length === 0 && docs.length === 0) return;
    if (sendingRef.current) return;
    const pendingImages = images;
    const pendingDocs = docs;
    sendingRef.current = true;
    try {
      if (value.startsWith("/")) {
        const [name, ...restParts] = value.slice(1).split(/\s+/);
        const command = commands.find((item) => item.name === name);
        if (command && (await runBuiltin(command, restParts.join(" ")))) {
          setText("");
          return;
        }
      }
      setText("");
      setImages([]);
      setDocs([]);
      const current = useAppStore.getState().snapshot;
      if (current && value) {
        const pending = { role: "user" as const, content: value, timestamp: Date.now() };
        const last = current.messages[current.messages.length - 1];
        const alreadyShown = last?.role === "user" && last.content === value;
        useAppStore.setState({
          busy: true,
          pendingUser: pending,
          activity: { message: "正在提交消息…", startedAt: Date.now() },
          snapshot: alreadyShown
            ? { ...current, isStreaming: true }
            : {
                ...current,
                isStreaming: true,
                messages: [...current.messages, pending],
              },
        });
      } else {
        useAppStore.setState({
          busy: true,
          activity: { message: "正在提交消息…", startedAt: Date.now() },
        });
      }
      // 文本类文档按 pi 的 @文件 格式内联到消息末尾：<file name="文件名">内容</file>
      const fileBlocks = pendingDocs
        .map((doc) => `<file name="${doc.name}">\n${doc.content}\n</file>`)
        .join("\n");
      const promptText = [value, fileBlocks].filter(Boolean).join("\n\n");
      await window.pi.prompt({
        text: promptText,
        images: pendingImages,
        // 流式对话中追加的消息默认进入 follow-up 队列（可在输入框上方的队列面板中转为 steer）
        streamingBehavior: snapshot?.isStreaming ? "followUp" : undefined,
      });
    } catch (error) {
      setText(value);
      setImages(pendingImages);
      setDocs(pendingDocs);
      useAppStore.setState({ busy: false, activity: undefined, pendingUser: undefined });
      pushToast("error", error instanceof Error ? error.message : String(error));
    } finally {
      sendingRef.current = false;
    }
  };

  const toggleFullTrust = async () => {
    if (!snapshot) return;
    const next = !fullTrust;
    useAppStore.setState((state) =>
      state.snapshot ? { snapshot: { ...state.snapshot, fullTrust: next } } : {},
    );
    try {
      await window.pi.setFullTrust(next);
      if (next) {
        const dialog = useAppStore.getState().dialog;
        if (dialog?.kind === "permission") {
          window.pi.respondDialog({ id: dialog.id, cancelled: false, value: "本会话允许" });
          setDialog(undefined);
        }
      }
    } catch (error) {
      useAppStore.setState((state) =>
        state.snapshot ? { snapshot: { ...state.snapshot, fullTrust: !next } } : {},
      );
      pushToast("error", error instanceof Error ? error.message : "无法切换完全信任");
    }
  };

  const pickFiles = (input: HTMLInputElement | null) => {
    setPlusOpen(false);
    setSkillsOpen(false);
    input?.click();
  };

  const onFilesChosen = (event: ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(event.target.files ?? []);
    event.target.value = "";
    for (const file of selected) void addAttachment(file);
  };

  return (
    <div className="border-t border-[#33392a] bg-[#1a1d16] p-3">
      {snapshot && (gpaEnabled || gpa?.awaitingConfirmation || ((snapshot.gpaPlanResume?.pendingCount ?? 0) > 0 && !busy)) && (
        <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
          {gpaEnabled && gpa && (
            <span className="rounded bg-[#22261c] px-2 py-0.5 text-[#c4d45a]">{GPA_STAGE_LABEL[gpa.stage]}</span>
          )}
          {gpa?.awaitingConfirmation && (
            <button
              type="button"
              className="rounded-md bg-[#c4d45a] px-2 py-0.5 text-[#16180f]"
              onClick={() => void window.pi.confirmGpa()}
            >
              {gpa.awaitingConfirmation === "goal" ? "✓ 确认目标，进入计划" : "✓ 确认计划，开始执行"}
            </button>
          )}
          {gpa?.stage === "act" && (snapshot.gpaPlanResume?.pendingCount ?? 0) > 0 && !busy && (
            <button
              type="button"
              className="rounded-md bg-[#c4d45a] px-2 py-0.5 text-[#16180f]"
              title="从上次中断的计划项继续执行"
              onClick={() => void window.pi.resumeGpaPlan()}
            >
              继续执行剩余任务（还剩 {snapshot.gpaPlanResume?.pendingCount} 项）
            </button>
          )}
        </div>
      )}
      {snapshot?.gpa && <PlanTimeline state={snapshot.gpa} isRunning={busy || Boolean(snapshot.isStreaming)} />}
      {(filteredCommands.length > 0 || files.length > 0) && (
        <div className="mb-2 max-h-40 overflow-auto rounded-lg border border-[#33392a] bg-[#12140f] p-2 text-sm">
          {filteredCommands.map((command) => (
            <button
              key={`${command.source}-${command.name}`}
              className="block w-full truncate px-2 py-1 text-left hover:bg-[#22261c]"
              onClick={() => setText(`/${command.name} `)}
            >
              /{command.name} <span className="text-[#9a937c]">{command.description}</span>
            </button>
          ))}
          {files.map((file) => (
            <button
              key={file.path}
              className="block w-full truncate px-2 py-1 text-left hover:bg-[#22261c]"
              onClick={() => {
                setText((current) => current.replace(/@([^\s]*)$/, `@${file.relative} `));
                setFiles([]);
              }}
            >
              @{file.relative}
            </button>
          ))}
        </div>
      )}
      {(images.length > 0 || docs.length > 0) && (
        <div className="mb-2 flex flex-wrap gap-2">
          {images.map((image, index) => (
            <div key={index} className="group relative">
              <img
                src={`data:${image.mimeType};base64,${image.data}`}
                alt={`附件 ${index + 1}`}
                title="点击预览"
                className="h-16 w-16 cursor-zoom-in rounded-lg border border-[#33392a] object-cover hover:border-[#c4d45a]"
                onClick={() => setPreview(image)}
              />
              <button
                type="button"
                title="移除图片"
                aria-label="移除图片"
                className="absolute -top-1.5 -right-1.5 rounded-full border border-[#33392a] bg-[#12140f] p-0.5 text-[#9a937c] hover:border-[#e07a5f] hover:text-[#e07a5f]"
                onClick={() => setImages((current) => current.filter((_, i) => i !== index))}
              >
                <X size={11} />
              </button>
            </div>
          ))}
          {docs.map((doc, index) => (
            <div key={`doc-${index}`} className="group relative">
              <button
                type="button"
                title={`${doc.name}（点击预览内容）`}
                className="flex h-16 w-16 cursor-zoom-in flex-col items-center justify-center gap-1 rounded-lg border border-[#33392a] bg-[#12140f] px-1 hover:border-[#c4d45a]"
                onClick={() => setPreviewDoc(doc)}
              >
                <FileText size={18} className="shrink-0 text-[#9a937c]" />
                <span className="w-full truncate text-center text-[9px] text-[#9a937c]">{doc.name}</span>
              </button>
              <button
                type="button"
                title="移除文档"
                aria-label="移除文档"
                className="absolute -top-1.5 -right-1.5 rounded-full border border-[#33392a] bg-[#12140f] p-0.5 text-[#9a937c] hover:border-[#e07a5f] hover:text-[#e07a5f]"
                onClick={() => setDocs((current) => current.filter((_, i) => i !== index))}
              >
                <X size={11} />
              </button>
            </div>
          ))}
        </div>
      )}
      <textarea
        ref={textareaRef}
        className="min-h-[88px] w-full resize-none rounded-xl border border-[#33392a] bg-[#12140f] px-3 py-2 text-sm text-[#ece7d5] outline-none focus:border-[#c4d45a]"
        placeholder="输入消息。/ 命令，@ 引用文件，! 运行 bash，!! 运行但不发给模型。Enter 发送，Shift+Enter 换行。"
        value={text}
        onChange={(event) => setText(event.target.value)}
        onPaste={(event) => {
          const items = Array.from(event.clipboardData.items);
          for (const item of items) {
            if (!item.type.startsWith("image/")) continue;
            const file = item.getAsFile();
            if (!file) continue;
            const reader = new FileReader();
            reader.onload = () => {
              const result = String(reader.result ?? "");
              const data = result.split(",")[1] ?? "";
              setImages((current) => [...current, { type: "image", data, mimeType: file.type }]);
            };
            reader.readAsDataURL(file);
          }
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            void submit();
          }
          if (event.key === "Escape" && busy) {
            void window.pi.abort();
          }
        }}
      />
      <div className="mt-2 flex items-center gap-2">
        <div ref={plusRef} className="relative shrink-0">
          <button
            type="button"
            title="更多"
            aria-label="打开加号菜单"
            aria-expanded={plusOpen}
            className={`flex h-8 w-8 items-center justify-center rounded-lg border text-sm ${
              plusOpen
                ? "border-[#c4d45a] bg-[#22261c] text-[#c4d45a]"
                : "border-[#33392a] text-[#ece7d5] hover:border-[#c4d45a]"
            }`}
            onClick={() => {
              setPlusOpen((open) => {
                const next = !open;
                if (!next) setSkillsOpen(false);
                return next;
              });
            }}
          >
            <Plus size={16} />
          </button>
          {plusOpen && (
            <div className="absolute bottom-full left-0 z-50 mb-2 w-64 rounded-xl border border-[#33392a] bg-[#1a1d16] py-1 shadow-xl">
              <PlusMenuItem
                icon={<File size={16} />}
                label="添加文件"
                onClick={() => pickFiles(fileInputRef.current)}
              />
              <PlusMenuItem
                icon={<Image size={16} />}
                label="添加图片"
                onClick={() => pickFiles(imageInputRef.current)}
              />
              <PlusMenuItem
                icon={<Sparkle size={16} />}
                label="Skills"
                trailing={<CaretRight size={12} className="text-[#9a937c]" />}
                active={skillsOpen}
                onClick={() => setSkillsOpen((open) => !open)}
              />
              <div className="my-1 border-t border-[#33392a]" />
              <PlusMenuItem
                icon={<ShieldCheck size={16} weight={fullTrust ? "fill" : "regular"} />}
                label="完全访问"
                badge={fullTrust ? "已开启" : undefined}
                active={fullTrust}
                accent="amber"
                title={
                  fullTrust
                    ? "已完全信任此项目：跳过工具风险确认。密钥/凭据文件仍禁止访问。"
                    : "开启后跳过此项目的工具风险确认框，运行中不再弹确认。密钥/凭据文件仍禁止访问。"
                }
                onClick={() => void toggleFullTrust()}
              />
              <PlusMenuItem
                icon={<CheckCircle size={16} weight={gpaEnabled ? "fill" : "regular"} />}
                label="开启 GPA"
                badge={gpaEnabled ? "已开启" : undefined}
                active={gpaEnabled}
                accent="blue"
                title={gpaEnabled ? "关闭 GPA 工作流" : "开启 GPA（目标 → 计划 → 执行）工作流"}
                onClick={() => void window.pi.setGpaEnabled(!gpaEnabled)}
              />
              {skillsOpen && (
                <div className="absolute bottom-0 left-full z-50 ml-1">
                  <SkillPicker
                    onSelect={(name) => {
                      insertSkill(name);
                      setPlusOpen(false);
                      setSkillsOpen(false);
                    }}
                  />
                </div>
              )}
            </div>
          )}
          <input ref={fileInputRef} type="file" multiple className="hidden" onChange={onFilesChosen} />
          <input ref={imageInputRef} type="file" multiple accept="image/*" className="hidden" onChange={onFilesChosen} />
        </div>
        <div className="ml-auto flex min-w-0 items-center justify-end gap-2">
          <ModelPicker placement="up" compact />
          {busy && (
            <button className="shrink-0 rounded-lg border border-[#e07a5f] px-3 py-1.5 text-sm text-[#e07a5f]" onClick={() => void window.pi.abort()}>
              <Stop size={14} className="mr-1 inline" />
              中止
            </button>
          )}
          <button
            className="shrink-0 rounded-lg bg-[#c4d45a] px-3 py-1.5 text-sm text-[#16180f] hover:bg-[#d7e56a]"
            onClick={() => void submit()}
          >
            <PaperPlaneTilt size={14} className="mr-1 inline" />
            发送
          </button>
        </div>
      </div>
      {preview && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="图片预览"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-8"
          onClick={() => setPreview(null)}
        >
          <img
            src={`data:${preview.mimeType};base64,${preview.data}`}
            alt="图片预览"
            className="max-h-full max-w-full rounded-lg object-contain"
            onClick={(event) => event.stopPropagation()}
          />
          <button
            type="button"
            title="关闭预览"
            aria-label="关闭预览"
            className="absolute top-4 right-4 rounded-full border border-[#33392a] bg-[#1a1d16] p-1.5 text-[#9a937c] hover:text-[#ece7d5]"
            onClick={() => setPreview(null)}
          >
            <X size={16} />
          </button>
        </div>
      )}
      {previewDoc && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="文档预览"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-8"
          onClick={() => setPreviewDoc(null)}
        >
          <div
            className="flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-[#33392a] bg-[#1a1d16]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center gap-2 border-b border-[#33392a] px-3 py-2 text-xs text-[#ece7d5]">
              <FileText size={14} className="shrink-0 text-[#9a937c]" />
              <span className="min-w-0 flex-1 truncate" title={previewDoc.name}>
                {previewDoc.name}
              </span>
              <button
                type="button"
                title="关闭预览"
                aria-label="关闭预览"
                className="rounded p-0.5 text-[#9a937c] hover:text-[#ece7d5]"
                onClick={() => setPreviewDoc(null)}
              >
                <X size={14} />
              </button>
            </div>
            <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap px-3 py-2 text-[11px] leading-5 text-[#ece7d5]">
              {previewDoc.content}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}

const ACCENT_CLASS: Record<string, string> = {
  amber: "text-[#e0a45a]",
  purple: "text-[#b48ec9]",
  blue: "text-[#7eb8c9]",
};

function PlusMenuItem({
  icon,
  label,
  trailing,
  badge,
  active,
  accent,
  title,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  trailing?: ReactNode;
  badge?: string;
  active?: boolean;
  accent?: "amber" | "purple" | "blue";
  title?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      className={`mx-1 flex w-[calc(100%-0.5rem)] items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm ${
        active ? "border border-[#c4d45a]/50 bg-[#22261c] text-[#ece7d5]" : "border border-transparent text-[#ece7d5] hover:bg-[#22261c]"
      }`}
      onClick={onClick}
    >
      <span className={`shrink-0 ${active ? "text-[#c4d45a]" : accent ? ACCENT_CLASS[accent] : "text-[#9a937c]"}`}>{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {badge && (
        <span className="shrink-0 rounded bg-[#2a3a22] px-1.5 py-0.5 text-[10px] text-[#8fbf7a]">{badge}</span>
      )}
      {trailing}
    </button>
  );
}
