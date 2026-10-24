import { useState } from "react";
import { useAppStore } from "../stores/app-store";
import { Button, Modal } from "./ui";
import { cx, inputClass } from "./ui";

/**
 * 模态对话框宿主：处理没有会话内归属的阻塞式提示
 * （confirm / input / secret / manual_code / select，例如服务商登录）。
 *
 * 澄清问题（questions）与权限确认（permission）在对话内渲染 —— 见 `InlineDialogHost`。
 * 改造点：容器改用统一 `Modal` 基座（审计 S8-1），Escape / 点击遮罩均可关闭，按钮改用共用 Button。
 */
export function DialogHost() {
  const dialog = useAppStore((state) => state.dialog);
  const setDialog = useAppStore((state) => state.setDialog);
  const [value, setValue] = useState("");

  if (!dialog || dialog.kind === "questions" || dialog.kind === "permission") return null;

  const close = (cancelled = false, result?: string | boolean) => {
    window.pi.respondDialog({ id: dialog.id, cancelled, value: result });
    setValue("");
    setDialog(undefined);
  };

  const isTextInput = dialog.kind === "input" || dialog.kind === "secret" || dialog.kind === "manual_code";

  const footer =
    dialog.kind === "confirm" ? (
      <>
        <Button onClick={() => close(false, false)}>取消</Button>
        <Button variant="primary" onClick={() => close(false, true)}>
          确认
        </Button>
      </>
    ) : isTextInput ? (
      <>
        <Button onClick={() => close(true)}>取消</Button>
        <Button variant="primary" onClick={() => close(false, value)}>
          确定
        </Button>
      </>
    ) : (
      <Button onClick={() => close(true)}>取消</Button>
    );

  return (
    <Modal
      title={dialog.title}
      description={dialog.message}
      size={dialog.kind === "select" ? "lg" : "md"}
      onClose={() => close(true)}
      footer={footer}
    >
      {isTextInput && (
        <input
          autoFocus
          aria-label={dialog.title}
          type={dialog.kind === "secret" ? "password" : "text"}
          className={inputClass}
          placeholder={dialog.placeholder}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") close(false, value);
          }}
        />
      )}
      {dialog.kind === "select" && (
        <div className="flex flex-col gap-2" role="listbox" aria-label={dialog.title}>
          {(dialog.options ?? []).map((option) => (
            <button
              key={option.id}
              type="button"
              role="option"
              aria-selected={false}
              className={cx(
                "flex flex-col rounded-control border border-line px-3 py-2 text-left transition-colors duration-[var(--motion-instant)] hover:border-accent hover:bg-surface-raised",
              )}
              onClick={() => close(false, option.id)}
            >
              <span className="text-sm text-ink">{option.label}</span>
              {option.description && <span className="mt-0.5 text-xs text-ink-muted">{option.description}</span>}
            </button>
          ))}
        </div>
      )}
    </Modal>
  );
}
