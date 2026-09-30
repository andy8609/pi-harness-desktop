import { useState } from "react";
import { useAppStore } from "../stores/app-store";

/**
 * Inline dialog surface for prompts that belong inside the conversation:
 * GPA clarification questions and tool permission approvals.
 *
 * They intentionally do not use a modal overlay — the card is rendered above
 * the composer, in the chat column.
 */
export function InlineDialogHost() {
  const dialog = useAppStore((state) => state.dialog);
  const setDialog = useAppStore((state) => state.setDialog);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [freeText, setFreeText] = useState<Record<string, string>>({});

  if (!dialog || (dialog.kind !== "questions" && dialog.kind !== "permission")) return null;

  const close = (cancelled = false, result?: string | boolean) => {
    window.pi.respondDialog({ id: dialog.id, cancelled, value: result });
    setAnswers({});
    setFreeText({});
    setDialog(undefined);
  };

  if (dialog.kind === "permission") {
    const permission = dialog.permission;
    return (
      <div className="mx-auto mb-2 max-w-5xl rounded-xl border border-[var(--danger)] bg-[var(--bg-panel)] p-3">
        <div className="mb-1 flex items-center gap-2 text-sm font-medium text-[var(--text)]">
          <span className="text-[var(--danger)]">⚠</span>
          {dialog.title}
        </div>
        {permission && (
          <>
            <div className="mb-2 text-xs text-[var(--muted)]">
              工具 {permission.toolName} · 风险等级：{permission.risk}
            </div>
            <pre className="mb-3 max-h-40 overflow-auto rounded border border-[var(--line)] bg-[var(--bg-code)] p-2 text-[11px] text-[var(--text)]">
              {permission.detail}
            </pre>
            <div className="flex flex-wrap gap-2">
              {(permission.options ?? []).map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={`rounded-lg border px-3 py-1.5 text-sm ${
                    option.id === "拒绝"
                      ? "border-[var(--danger)] text-[var(--danger)] hover:bg-[var(--danger)] hover:text-[#16180f]"
                      : "border-[var(--line)] hover:border-[var(--accent)]"
                  }`}
                  onClick={() => close(false, option.id)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    );
  }

  const questions = dialog.questions ?? [];
  return (
    <div className="mx-auto mb-2 flex max-h-[60vh] max-w-5xl flex-col rounded-xl border border-[var(--accent)] bg-[var(--bg-panel)] p-3">
      <div className="mb-2 shrink-0 text-sm font-medium text-[var(--text)]">{dialog.title}</div>
      {/* 问题列表内部滚动：内容过多时保持标题与操作按钮可见 */}
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
        {questions.map((question) => (
          <div key={question.id}>
            <div className="text-sm font-medium text-[var(--text)]">{question.label}</div>
            <div className="mb-1 text-xs text-[var(--muted)]">{question.prompt}</div>
            <div className="flex flex-wrap gap-2">
              {question.options.map((option) => {
                const selected = answers[question.id] === option.label && !freeText[question.id]?.trim();
                return (
                  <button
                    key={option.id}
                    type="button"
                    className={`rounded-lg border px-3 py-1.5 text-sm ${
                      selected
                        ? "border-[#c4d45a] bg-[#c4d45a] text-[#16180f]"
                        : "border-[var(--line)] hover:border-[var(--accent)]"
                    }`}
                    onClick={() =>
                      setAnswers((current) => ({ ...current, [question.id]: option.label }))
                    }
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
            <input
              className="mt-2 w-full rounded border border-[var(--line)] bg-[var(--bg)] px-2 py-1 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
              placeholder="以上都不合适？在此手动输入"
              value={freeText[question.id] ?? ""}
              onChange={(event) =>
                setFreeText((current) => ({ ...current, [question.id]: event.target.value }))
              }
            />
          </div>
        ))}
      </div>
      <div className="mt-3 flex shrink-0 justify-end gap-2">
        <button
          type="button"
          className="rounded-lg border border-[var(--line)] px-3 py-1.5 text-sm"
          onClick={() => close(true)}
        >
          取消
        </button>
        <button
          type="button"
          className="rounded-lg bg-[#c4d45a] px-3 py-1.5 text-sm text-[#16180f]"
          onClick={() => {
            const merged: Record<string, string> = {};
            for (const question of questions) {
              merged[question.id] = (freeText[question.id]?.trim() || answers[question.id] || "").trim();
            }
            close(false, JSON.stringify(merged));
          }}
        >
          提交
        </button>
      </div>
    </div>
  );
}
