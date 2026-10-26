import { useEffect, useState } from "react";
import type { McpToolView } from "@shared/mcp";
import { Switch } from "../ui";

/**
 * 某个服务器的工具清单（行内展开）。
 *
 * 工具级开关关闭后不会注册给模型；这里的列表来自最近一次握手，因此未连接时为空，
 * 需要先点「测试」建立连接。
 */
export function McpToolList({ serverId, onError }: { serverId: string; onError: (message: string) => void }) {
  const [tools, setTools] = useState<McpToolView[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void window.pi
      .mcpListTools(serverId)
      .then((result) => {
        if (active) setTools(result.tools);
      })
      .catch((error: unknown) => onError(error instanceof Error ? error.message : String(error)))
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [serverId, onError]);

  const toggle = async (tool: McpToolView, enabled: boolean) => {
    setBusy(tool.name);
    try {
      await window.pi.mcpSetToolEnabled(serverId, tool.name, enabled);
      setTools((current) => current.map((item) => (item.name === tool.name ? { ...item, enabled } : item)));
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  };

  const disabledCount = tools.filter((tool) => !tool.enabled).length;

  return (
    <div className="rounded-control border border-line-subtle bg-surface-muted px-3 py-2">
      <div className="mb-1.5 flex items-center justify-between text-2xs text-ink-muted">
        <span>
          工具 {tools.length} 个
          {disabledCount > 0 ? ` · 已禁用 ${disabledCount} 个` : ""}
        </span>
        <span>关闭后模型看不到该工具</span>
      </div>
      {loading ? (
        <p className="py-2 text-2xs text-ink-muted">加载中…</p>
      ) : tools.length === 0 ? (
        <p className="py-2 text-2xs text-ink-muted">还没有发现工具。先点「测试」建立连接，成功后再查看。</p>
      ) : (
        <ul className="flex max-h-64 flex-col divide-y divide-line-subtle overflow-y-auto">
          {tools.map((tool) => (
            <li key={tool.name} className="flex items-center gap-3 py-1.5">
              <div className="min-w-0 flex-1">
                <div className="truncate font-mono text-xs text-ink" title={tool.name}>
                  {tool.name}
                </div>
                {tool.description && (
                  <div className="truncate text-2xs text-ink-muted" title={tool.description}>
                    {tool.description}
                  </div>
                )}
              </div>
              <Switch
                checked={tool.enabled}
                disabled={busy === tool.name}
                label={`${tool.enabled ? "禁用" : "启用"}工具 ${tool.name}`}
                onChange={(next) => void toggle(tool, next)}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
