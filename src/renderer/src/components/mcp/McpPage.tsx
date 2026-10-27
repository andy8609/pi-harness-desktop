import { ArrowsClockwise } from "@phosphor-icons/react";
import { useCallback, useEffect, useState } from "react";
import type { McpSnapshot } from "@shared/mcp";
import { useAppStore } from "../../stores/app-store";
import {
  Button,
  PageBody,
  PageHeader,
  PageShell,
  SegmentedControl,
} from "../ui";
import { McpMarketPanel } from "./McpMarketPanel";
import { McpSettingsPanel } from "./McpSettingsPanel";

const EMPTY: McpSnapshot = { servers: [], statuses: [] };
type McpTab = "installed" | "market";

/**
 * MCP 独立页面：已安装 / 市场 两个 Tab。
 *
 * 数据在这一层统一拉取并订阅 `mcp:changed`，两个 Tab 共享同一份快照；
 * 市场安装成功后切回已安装并刷新。
 */
export function McpPage() {
  const pushToast = useAppStore((state) => state.pushToast);
  const [snapshot, setSnapshot] = useState<McpSnapshot>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<McpTab>("installed");

  const reload = useCallback(async () => {
    const next = await window.pi.mcpRefresh();
    setSnapshot(next);
  }, []);

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

  return (
    <PageShell>
      <PageHeader
        title="MCP"
        description="接入 Model Context Protocol 服务器：stdio 会在本机启动进程，HTTP 只发起网络请求。安装后工具会自动出现在模型的工具列表里。"
        actions={
          <>
            <Button
              size="sm"
              icon={<ArrowsClockwise size={13} />}
              disabled={loading}
              onClick={() =>
                void reload().catch((error: unknown) =>
                  pushToast("error", error instanceof Error ? error.message : String(error)),
                )
              }
            >
              重新读取
            </Button>
            <SegmentedControl
              ariaLabel="MCP 视图"
              size="sm"
              value={tab}
              onChange={(next) => setTab(next)}
              options={[
                { id: "installed", label: `已安装 ${snapshot.servers.length}` },
                { id: "market", label: "市场" },
              ]}
            />
          </>
        }
      />

      <PageBody>
        {tab === "installed" ? (
          <McpSettingsPanel snapshot={snapshot} loading={loading} />
        ) : (
          <McpMarketPanel
            installedIds={snapshot.servers.map((server) => server.id)}
            onInstalled={() => {
              setTab("installed");
              void reload().catch(() => undefined);
            }}
          />
        )}
      </PageBody>
    </PageShell>
  );
}
