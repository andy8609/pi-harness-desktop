import { ArrowUp, CaretDown, CaretRight, Check, ListDashes, PencilSimple, Trash, X } from "@phosphor-icons/react";
import { useState } from "react";
import type { QueueMutation } from "@shared/types";
import { useAppStore } from "../stores/app-store";

/**
 * 待发送消息队列面板（位于输入框上方）：
 * 流式对话中追加的消息默认进入 follow-up 队列（当前回合结束后发送）；
 * 点击向上箭头可转为 steer（立即插入当前回合），也可编辑或删除。
 * 服务端不支持单条增删，编辑/删除实现为清空后重建队列。
 */
export function MessageQueue() {
  const queue = useAppStore((state) => state.snapshot?.queue);
  const pushToast = useAppStore((state) => state.pushToast);
  const [open, setOpen] = useState(true);
  const [editing, setEditing] = useState<{ text: string; value: string } | null>(null);
  /** 正在执行"转为 steer"的消息文本：按钮位置显示转圈，直到队列重建完成 */
  const [movingTexts, setMovingTexts] = useState<string[]>([]);

  const steering = queue?.steering ?? [];
  const followUp = queue?.followUp ?? [];
  const total = steering.length + followUp.length;
  if (total === 0) return null;

  const mutate = async (action: QueueMutation) => {
    try {
      await window.pi.mutateQueue(action);
      setEditing(null);
    } catch (error) {
      pushToast("error", error instanceof Error ? error.message : String(error));
    }
  };

  const saveEdit = () => {
    if (!editing) return;
    const value = editing.value.trim();
    if (!value) {
      pushToast("error", "队列消息内容不能为空");
      return;
    }
    if (value === editing.text) {
      setEditing(null);
      return;
    }
    void mutate({ type: "update", text: editing.text, newText: value });
  };

  // 转为 steer：点击后按钮位置立即显示转圈，直到队列重建完成
  const startToSteer = async (text: string) => {
    setMovingTexts((current) => (current.includes(text) ? current : [...current, text]));
    try {
      await window.pi.mutateQueue({ type: "toSteer", text });
    } catch (error) {
      pushToast("error", error instanceof Error ? error.message : String(error));
    } finally {
      setMovingTexts((current) => current.filter((item) => item !== text));
    }
  };

  // steer 消息优先消费，展示在前
  const rows = [
    ...steering.map((text) => ({ text, kind: "steer" as const })),
    ...followUp.map((text) => ({ text, kind: "followUp" as const })),
  ];

  const actionClass = "rounded p-1 text-[var(--muted)] hover:bg-[var(--bg-raised)] hover:text-[var(--text)]";

  return (
    <div className="mx-auto mb-1 max-w-5xl rounded-xl border border-[var(--line)] bg-[var(--bg-panel)]">
      <button
        type="button"
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-xs text-[var(--muted)] hover:text-[var(--text)]"
        onClick={() => setOpen((value) => !value)}
      >
        {open ? <CaretDown size={11} className="shrink-0" /> : <CaretRight size={11} className="shrink-0" />}
        队列 ({total})
      </button>
      {open &&
        rows.map((row, index) => {
          const isEditing = editing?.text === row.text;
          const isMoving = movingTexts.includes(row.text);
          return (
            <div
              key={`${row.kind}-${index}-${row.text}`}
              className="flex items-center gap-2 border-t border-[var(--line)] px-3 py-1.5"
            >
              {isEditing ? (
                <input
                  autoFocus
                  className="min-w-0 flex-1 rounded border border-[var(--line)] bg-[var(--bg)] px-2 py-0.5 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
                  value={editing.value}
                  onChange={(event) => setEditing({ text: row.text, value: event.target.value })}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      saveEdit();
                    }
                    if (event.key === "Escape") setEditing(null);
                  }}
                />
              ) : (
                <>
                  <ListDashes
                    size={13}
                    className={`shrink-0 ${row.kind === "steer" ? "text-[var(--accent)]" : "text-[var(--muted)]"}`}
                  />
                  <span
                    className={`min-w-0 flex-1 truncate text-xs ${
                      row.kind === "steer" ? "text-[var(--accent)]" : "text-[var(--text)]"
                    }`}
                    title={row.kind === "steer" ? `[steer] ${row.text}` : row.text}
                  >
                    {row.text}
                  </span>
                </>
              )}
              <div className="flex shrink-0 items-center gap-0.5">
                {isEditing ? (
                  <>
                    <button type="button" title="保存" aria-label="保存" className={actionClass} onClick={saveEdit}>
                      <Check size={13} />
                    </button>
                    <button
                      type="button"
                      title="取消编辑"
                      aria-label="取消编辑"
                      className={actionClass}
                      onClick={() => setEditing(null)}
                    >
                      <X size={13} />
                    </button>
                  </>
                ) : (
                  <>
                    {row.kind === "followUp" && !isMoving && (
                      <button
                        type="button"
                        title="转为 steer：立即插入当前回合"
                        aria-label="转为 steer"
                        className={actionClass}
                        onClick={() => void startToSteer(row.text)}
                      >
                        <ArrowUp size={13} />
                      </button>
                    )}
                    {(row.kind === "steer" || isMoving) && (
                      <span
                        className="flex items-center justify-center p-1"
                        title={row.kind === "steer" ? "等待插入当前回合…" : "正在转为 steer…"}
                        aria-label={row.kind === "steer" ? "等待插入当前回合" : "正在转为 steer"}
                      >
                        <span className="inline-block h-3 w-3 animate-spin rounded-full border border-[var(--accent)] border-t-transparent" />
                      </span>
                    )}
                    <button
                      type="button"
                      title="编辑"
                      aria-label="编辑"
                      className={actionClass}
                      onClick={() => setEditing({ text: row.text, value: row.text })}
                    >
                      <PencilSimple size={13} />
                    </button>
                    <button
                      type="button"
                      title="删除"
                      aria-label="删除"
                      className={`${actionClass} hover:text-[var(--danger)]`}
                      onClick={() => void mutate({ type: "remove", text: row.text })}
                    >
                      <Trash size={13} />
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })}
    </div>
  );
}
