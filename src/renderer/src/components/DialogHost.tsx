import { useState } from "react";
import { useAppStore } from "../stores/app-store";

export function DialogHost() {
  const dialog = useAppStore((state) => state.dialog);
  const setDialog = useAppStore((state) => state.setDialog);
  const [value, setValue] = useState("");

  if (!dialog) return null;

  const close = (cancelled = false, result?: string | boolean) => {
    window.pi.respondDialog({ id: dialog.id, cancelled, value: result });
    setValue("");
    setDialog(undefined);
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-2xl border border-[#33392a] bg-[#1a1d16] p-5">
        <h2 className="mb-2 text-lg font-medium whitespace-pre-wrap">{dialog.title}</h2>
        {dialog.message && <p className="mb-3 text-sm text-[#9a937c] whitespace-pre-wrap">{dialog.message}</p>}
        {dialog.kind === "confirm" && (
          <div className="flex justify-end gap-2">
            <button className="rounded-lg border border-[#33392a] px-3 py-1.5" onClick={() => close(false, false)}>
              取消
            </button>
            <button className="rounded-lg bg-[#c4d45a] px-3 py-1.5 text-[#16180f]" onClick={() => close(false, true)}>
              确认
            </button>
          </div>
        )}
        {(dialog.kind === "input" || dialog.kind === "secret" || dialog.kind === "manual_code") && (
          <div>
            <input
              autoFocus
              type={dialog.kind === "secret" ? "password" : "text"}
              className="mb-3 w-full rounded border border-[#33392a] bg-[#12140f] px-3 py-2"
              placeholder={dialog.placeholder}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") close(false, value);
              }}
            />
            <div className="flex justify-end gap-2">
              <button className="rounded-lg border border-[#33392a] px-3 py-1.5" onClick={() => close(true)}>
                取消
              </button>
              <button className="rounded-lg bg-[#c4d45a] px-3 py-1.5 text-[#16180f]" onClick={() => close(false, value)}>
                确定
              </button>
            </div>
          </div>
        )}
        {dialog.kind === "select" && (
          <div className="space-y-2">
            {(dialog.options ?? []).map((option) => (
              <button
                key={option.id}
                className="block w-full rounded-lg border border-[#33392a] px-3 py-2 text-left hover:border-[#c4d45a]"
                onClick={() => close(false, option.id)}
              >
                <div>{option.label}</div>
                {option.description && <div className="text-xs text-[#9a937c]">{option.description}</div>}
              </button>
            ))}
            <button className="mt-2 text-sm text-[#9a937c]" onClick={() => close(true)}>
              取消
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
