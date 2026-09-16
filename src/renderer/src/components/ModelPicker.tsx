import type { ThinkingLevel } from "@shared/types";
import { refreshModelsAndSessions, useAppStore } from "../stores/app-store";

const LEVELS: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

export function ModelPicker() {
  const snapshot = useAppStore((state) => state.snapshot);
  const models = useAppStore((state) => state.models);
  const pushToast = useAppStore((state) => state.pushToast);
  const available = models.filter((model) => model.available);
  const current = snapshot?.model ? `${snapshot.model.provider}/${snapshot.model.id}` : "";

  return (
    <div className="flex items-center gap-2">
      <select
        className="max-w-[260px] rounded-lg border border-[#33392a] bg-[#12140f] px-2 py-1 text-xs"
        value={current}
        onChange={async (event) => {
          const [provider, ...rest] = event.target.value.split("/");
          try {
            await window.pi.setModel(provider, rest.join("/"));
            await refreshModelsAndSessions();
          } catch (error) {
            pushToast("error", error instanceof Error ? error.message : String(error));
          }
        }}
      >
        <option value="">选择模型</option>
        {available.map((model) => (
          <option key={`${model.provider}/${model.id}`} value={`${model.provider}/${model.id}`}>
            {model.provider}/{model.name}
          </option>
        ))}
      </select>
      <select
        className="rounded-lg border border-[#33392a] bg-[#12140f] px-2 py-1 text-xs"
        value={snapshot?.thinkingLevel ?? "off"}
        onChange={async (event) => {
          await window.pi.setThinkingLevel(event.target.value as ThinkingLevel);
        }}
      >
        {LEVELS.map((level) => (
          <option key={level} value={level}>
            {level}
          </option>
        ))}
      </select>
    </div>
  );
}
