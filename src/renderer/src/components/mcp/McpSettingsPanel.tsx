import { ArrowsClockwise, PencilSimple, Play, PlugsConnected, Plus, Trash } from "@phosphor-icons/react";
import { useCallback, useEffect, useState } from "react";
import type { McpServerRecord, McpServerStatus, McpSnapshot } from "@shared/mcp";
import { useAppStore } from "../../stores/app-store";
import {
  Badge,
  Button,
  EmptyState,
  IconButton,
  SectionCard,
  SkeletonList,
  Switch,
  cx,
} from "../ui";
import { McpServerDialog } from "./McpServerDialog";
import { McpToolList } from "./McpToolList";

const EMPTY: McpSnapshot = { servers: [], statuses: [] };

type DialogState = { record?: McpServerRecord } | null;

/**
 * 设置页的 MCP 分区。
 *
 * 数据来自 `mcp:list` 全量快照 + `mcp:changed` 推送；不在 zustand 里再存一份，
 * 避免连接状态在多处漂移。所有操作都是 IPC 调用后等待推送刷新。
 */
export function McpSettingsPanel() {
  const pushToast = useAppStore((state) => state.pushToast);
  const [snapshot, setSnapshot] = useState<McpSnapshot>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [armedId, setArmedId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void window.pi
      .mcpList()
      .then((next) => {
        if (active) setSnapshot(next);
      })
      .catch((error: unknown) => {
        if (active) pushToast("error", error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    const off = window.pi.onMcpChanged((next) => setSnapshot(next));
    return () => {
      active = false;
      off();
    };
  }, [pushToast]);

  const run = useCallback(
    async (id: string, action: () => Promise<unknown>, success?: string) => {
      setBusyId(id);
      try {
        await action();
        if (success) pushToast("info", success);
      } catch (error) {
        pushToast("error", error instanceof Error ? error.message : String(error));
      } finally {
        setBusyId(null);
      }
    },
    [pushToast],
  );

  const refresh = async () => {
    setLoading(true);
    try {
      setSnapshot(await window.pi.mcpRefresh());
    } catch (error) {
      pushToast("error", error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  };

  return (
    <SectionCard
      headingLevel={2}
      title="MCP 服务器"
      description="通过 Model Context Protocol 接入外部工具。stdio 服务器会在本机启动进程；HTTP 服务器只发起网络请求。"
      actions={
        <div className="flex items-center gap-2">
          <Button size="sm" icon={<ArrowsClockwise size={13} />} disabled={loading} onClick={() => void refresh()}>
            重新读取
          </Button>
          <Button size="sm" variant="primary" icon={<Plus size={13} />} onClick={() => setDialog({})}>
            新增服务器
          </Button>
        </div>
      }
    >
      {loading ? (
        <SkeletonList rows={3} />
      ) : snapshot.servers.length === 0 ? (
        <EmptyState
          icon={<PlugsConnected size={22} />}
          title="还没有 MCP 服务器"
          description="添加一个服务器后，它提供的工具会出现在模型的工具列表里。可先用本地 mock 服务器验证：command 填 node，args 填 scripts/mock-mcp-server.mjs。"
          action={
            <Button variant="primary" size="sm" onClick={() => setDialog({})}>
              新增第一个服务器
            </Button>
          }
        />
      ) : (
        <ul className="flex flex-col divide-y divide-line-subtle">
          {snapshot.servers.map((server) => {
            const status = statusFor(snapshot.statuses, server.id);
            const busy = busyId === server.id;
            const armed = armedId === server.id;
            return (
              <li key={server.id} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="truncate text-sm font-medium text-ink">{server.label}</span>
                      <Badge tone="neutral">{server.transport === "stdio" ? "stdio" : "HTTP"}</Badge>
                      <StatusBadge status={status} />
                      {server.scope.mode === "projects" && (
                        <Badge tone="info">仅 {server.scope.projects.length} 个项目</Badge>
                      )}
                      {status?.authRequired && <Badge tone="warning">需要授权</Badge>}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-2xs text-ink-muted">
                      <span className="font-mono">#{server.id}</span>
                      <span>·</span>
                      <span>工具 {status?.toolCount ?? 0} 个</span>
                      {server.transport === "stdio" ? (
                        <>
                          <span>·</span>
                          <span className="max-w-[28rem] truncate" title={[server.command, ...(server.args ?? [])].join(" ")}>
                            {server.command} {(server.args ?? []).join(" ")}
                          </span>
                        </>
                      ) : (
                        <>
                          <span>·</span>
                          <span className="max-w-[28rem] truncate" title={server.url}>
                            {server.url}
                          </span>
                        </>
                      )}
                    </div>
                    {status?.message && (
                      <p
                        className={cx("mt-1 text-2xs", status.state === "failed" ? "text-danger" : "text-ink-muted")}
                        title={status.message}
                      >
                        {status.message}
                      </p>
                    )}
                  </div>

                  <div className="flex shrink-0 items-center gap-1.5">
                    <Switch
                      checked={server.enabled}
                      disabled={busy}
                      label={`${server.enabled ? "停用" : "启用"} ${server.label}`}
                      onChange={(next) =>
                        void run(server.id, () => window.pi.mcpSetEnabled(server.id, next), next ? "已启用" : "已停用")
                      }
                    />
                    <Button
                      size="sm"
                      icon={<Play size={12} />}
                      disabled={busy}
                      onClick={() =>
                        void run(server.id, async () => {
                          const { status } = await window.pi.mcpTest(server.id);
                          pushToast(
                            status.state === "ready" ? "info" : "error",
                            status.state === "ready"
                              ? `连接成功，发现 ${status.toolCount} 个工具`
                              : status.message ?? "连接失败",
                          );
                        })
                      }
                    >
                      测试
                    </Button>
                    <Button
                      size="sm"
                      icon={<PlugsConnected size={12} />}
                      disabled={busy || !server.enabled}
                      onClick={() => setExpandedId(expandedId === server.id ? null : server.id)}
                    >
                      工具
                    </Button>
                    <IconButton
                      size="sm"
                      label={`编辑 ${server.label}`}
                      disabled={busy}
                      onClick={() => setDialog({ record: server })}
                    >
                      <PencilSimple size={13} />
                    </IconButton>
                    <IconButton
                      size="sm"
                      variant={armed ? "danger" : "ghost"}
                      label={armed ? `确认删除 ${server.label}` : `删除 ${server.label}`}
                      disabled={busy}
                      onClick={() => {
                        if (!armed) {
                          setArmedId(server.id);
                          return;
                        }
                        setArmedId(null);
                        void run(server.id, () => window.pi.mcpRemove(server.id), "已删除");
                      }}
                    >
                      <Trash size={13} />
                    </IconButton>
                  </div>
                </div>

                {expandedId === server.id && (
                  <McpToolList
                    serverId={server.id}
                    onError={(message) => pushToast("error", message)}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}

      {dialog && (
        <McpServerDialog
          record={dialog.record}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null);
            void refresh();
          }}
        />
      )}
    </SectionCard>
  );
}

function statusFor(statuses: McpServerStatus[], serverId: string): McpServerStatus | undefined {
  return statuses.find((status) => status.serverId === serverId);
}

function StatusBadge({ status }: { status?: McpServerStatus }) {
  const state = status?.state ?? "idle";
  if (state === "ready") return <Badge tone="success">已连接</Badge>;
  if (state === "connecting") return <Badge tone="info">连接中</Badge>;
  if (state === "failed") return <Badge tone="danger">连接失败</Badge>;
  return <Badge tone="neutral">未连接</Badge>;
}
