import { useEffect, useState } from "react";
import type { DesktopSettings, ThinkingLevel } from "@shared/types";
import { refreshModelsAndSessions, useAppStore } from "../stores/app-store";

export function SettingsPage() {
  const snapshot = useAppStore((state) => state.snapshot);
  const settings = useAppStore((state) => state.settings);
  const resources = snapshot?.resources;
  const [draft, setDraft] = useState<DesktopSettings>(settings);
  const pushToast = useAppStore((state) => state.pushToast);

  useEffect(() => {
    setDraft(settings);
  }, [settings]);

  return (
    <section className="h-full overflow-auto px-6 py-5">
      <h1 className="text-xl font-semibold">设置</h1>
      <p className="mt-1 mb-6 text-sm text-[#9a937c]">这些项写入 ~/.pi/agent/settings.json，与 CLI 共用。</p>

      <div className="mb-6 grid max-w-xl gap-3">
        <label className="text-sm">
          默认思考等级
          <select
            className="mt-1 w-full rounded border border-[#33392a] bg-[#12140f] px-2 py-1"
            value={draft.defaultThinkingLevel ?? "medium"}
            onChange={(e) => setDraft({ ...draft, defaultThinkingLevel: e.target.value as ThinkingLevel })}
          >
            {["off", "minimal", "low", "medium", "high", "xhigh", "max"].map((level) => (
              <option key={level} value={level}>
                {level}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={Boolean(draft.hideThinkingBlock)}
            onChange={(e) => setDraft({ ...draft, hideThinkingBlock: e.target.checked })}
          />
          隐藏思考块
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={draft.compactionEnabled !== false}
            onChange={(e) => setDraft({ ...draft, compactionEnabled: e.target.checked })}
          />
          自动压缩
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={draft.retryEnabled !== false}
            onChange={(e) => setDraft({ ...draft, retryEnabled: e.target.checked })}
          />
          自动重试
        </label>
        <label className="text-sm">
          项目信任默认
          <select
            className="mt-1 w-full rounded border border-[#33392a] bg-[#12140f] px-2 py-1"
            value={draft.defaultProjectTrust ?? "ask"}
            onChange={(e) => setDraft({ ...draft, defaultProjectTrust: e.target.value as DesktopSettings["defaultProjectTrust"] })}
          >
            <option value="ask">询问</option>
            <option value="always">始终信任</option>
            <option value="never">从不加载项目配置</option>
          </select>
        </label>
        <button
          className="w-fit rounded-lg bg-[#c4d45a] px-3 py-1.5 text-sm text-[#16180f]"
          onClick={async () => {
            await window.pi.updateSettings(draft);
            await refreshModelsAndSessions();
            pushToast("info", "设置已保存");
          }}
        >
          保存设置
        </button>
      </div>

      <div className="mb-6">
        <h2 className="mb-2 font-medium">项目信任</h2>
        <div className="mb-2 text-sm text-[#9a937c]">当前：{snapshot?.projectTrusted ? "已信任" : "未信任"}</div>
        <div className="flex gap-2">
          <button className="rounded border border-[#33392a] px-3 py-1 text-sm" onClick={() => window.pi.trustProject(true)}>
            信任此目录
          </button>
          <button className="rounded border border-[#33392a] px-3 py-1 text-sm" onClick={() => window.pi.trustProject(true, true)}>
            信任父目录
          </button>
          <button className="rounded border border-[#33392a] px-3 py-1 text-sm" onClick={() => window.pi.trustProject(false)}>
            取消信任
          </button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <ResourceCard title="提示模板" items={(resources?.prompts ?? []).map((item) => item.name)} />
        <ResourceCard title="上下文文件" items={(resources?.agentsFiles ?? []).map((item) => item.path)} />
      </div>
    </section>
  );
}

function ResourceCard({ title, items, note }: { title: string; items: string[]; note?: string }) {
  return (
    <div className="rounded-xl border border-[#33392a] bg-[#1a1d16] p-4">
      <h3 className="mb-2 font-medium">{title}</h3>
      {note && <p className="mb-2 text-xs text-[#9a937c]">{note}</p>}
      {items.length === 0 ? (
        <div className="text-sm text-[#9a937c]">无</div>
      ) : (
        <ul className="space-y-1 text-sm">
          {items.map((item) => (
            <li key={item} className="truncate">
              {item}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
