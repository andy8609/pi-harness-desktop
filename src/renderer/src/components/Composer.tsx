import { Paperclip, Stop, PaperPlaneTilt } from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { FileSearchResult, PromptImage, SlashCommand, StreamingBehavior } from "@shared/types";
import { refreshModelsAndSessions, useAppStore } from "../stores/app-store";

export function Composer() {
  const [text, setText] = useState("");
  const [images, setImages] = useState<PromptImage[]>([]);
  const [files, setFiles] = useState<FileSearchResult[]>([]);
  const [behavior, setBehavior] = useState<StreamingBehavior>("steer");
  const snapshot = useAppStore((state) => state.snapshot);
  const commands = useAppStore((state) => state.commands);
  const applySnapshot = useAppStore((state) => state.applySnapshot);
  const pushToast = useAppStore((state) => state.pushToast);
  const setView = useAppStore((state) => state.setView);
  const busy = useAppStore((state) => state.busy);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const sendingRef = useRef(false);

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

  const submit = async (mode?: StreamingBehavior) => {
    const value = text.trim();
    if (!value && images.length === 0) return;
    if (sendingRef.current) return;
    const pendingImages = images;
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
      await window.pi.prompt({
        text: value,
        images: pendingImages,
        streamingBehavior: snapshot?.isStreaming ? mode ?? behavior : undefined,
      });
    } catch (error) {
      setText(value);
      setImages(pendingImages);
      useAppStore.setState({ busy: false, activity: undefined, pendingUser: undefined });
      pushToast("error", error instanceof Error ? error.message : String(error));
    } finally {
      sendingRef.current = false;
    }
  };

  return (
    <div className="border-t border-[#33392a] bg-[#1a1d16] p-3">
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
      {snapshot?.queue && (snapshot.queue.steering.length > 0 || snapshot.queue.followUp.length > 0) && (
        <div className="mb-2 text-xs text-[#9a937c]">
          队列 steer {snapshot.queue.steering.length} / follow-up {snapshot.queue.followUp.length}
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
            void submit(event.altKey ? "followUp" : undefined);
          }
          if (event.key === "Escape" && busy) {
            void window.pi.abort();
          }
        }}
      />
      <div className="mt-2 flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs text-[#9a937c]">
          <label className="flex items-center gap-1">
            排队
            <select
              className="rounded border border-[#33392a] bg-[#12140f] px-1 py-0.5"
              value={behavior}
              onChange={(event) => setBehavior(event.target.value as StreamingBehavior)}
            >
              <option value="steer">steer</option>
              <option value="followUp">follow-up</option>
            </select>
          </label>
          {images.length > 0 && <span>{images.length} 张图片</span>}
          <label className="flex cursor-pointer items-center gap-1">
            <Paperclip size={14} />
            图片
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = () => {
                  const result = String(reader.result ?? "");
                  const data = result.split(",")[1] ?? "";
                  setImages((current) => [...current, { type: "image", data, mimeType: file.type }]);
                };
                reader.readAsDataURL(file);
              }}
            />
          </label>
        </div>
        <div className="flex gap-2">
          {busy && (
            <button className="rounded-lg border border-[#e07a5f] px-3 py-1.5 text-sm text-[#e07a5f]" onClick={() => void window.pi.abort()}>
              <Stop size={14} className="mr-1 inline" />
              中止
            </button>
          )}
          <button
            className="rounded-lg bg-[#c4d45a] px-3 py-1.5 text-sm text-[#16180f] hover:bg-[#d7e56a]"
            onClick={() => void submit()}
          >
            <PaperPlaneTilt size={14} className="mr-1 inline" />
            发送
          </button>
        </div>
      </div>
    </div>
  );
}
