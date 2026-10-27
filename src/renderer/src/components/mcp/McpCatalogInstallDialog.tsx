import { useMemo, useState } from "react";
import {
  resolveCatalogEntry,
  type McpCatalogEntry,
} from "@shared/mcp-catalog";
import { useAppStore } from "../../stores/app-store";
import {
  Badge,
  Button,
  Field,
  Modal,
  inputClass,
} from "../ui";

/**
 * 市场条目的安装表单。
 *
 * 只做三件事：按 `requiredEnv` 收集值、预览最终命令、调用 `mcp:marketInstall`。
 * 校验前后端各做一次（这里给即时反馈，主进程仍有最终裁决）。
 */
export function McpCatalogInstallDialog({
  entry,
  alreadyInstalled,
  onClose,
  onInstalled,
}: {
  entry: McpCatalogEntry;
  alreadyInstalled: boolean;
  onClose: () => void;
  onInstalled: (id: string) => void;
}) {
  const pushToast = useAppStore((state) => state.pushToast);
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries((entry.requiredEnv ?? []).map((spec) => [spec.name, spec.defaultValue ?? ""])),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const preview = useMemo(() => {
    try {
      const input = resolveCatalogEntry(entry, values);
      if (input.transport === "http") {
        const headers = Object.keys(input.headers ?? {});
        return `${input.url}${headers.length ? `\n请求头：${headers.join(", ")}` : ""}`;
      }
      return [input.command, ...(input.args ?? [])].filter(Boolean).join(" ");
    } catch (caught) {
      return caught instanceof Error ? caught.message : String(caught);
    }
  }, [entry, values]);

  const previewFailed = /缺少|未在 requiredEnv|必须|不合法/.test(preview);

  const save = async () => {
    try {
      resolveCatalogEntry(entry, values);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      return;
    }
    setError("");
    setSaving(true);
    try {
      const result = await window.pi.mcpMarketInstall(entry, values);
      if (result.cancelled) {
        pushToast("warning", "未确认命令，服务器没有安装");
        onClose();
        return;
      }
      pushToast("info", `已安装 ${entry.name}`);
      onInstalled(result.server.id);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      setError(message);
      pushToast("error", message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={`安装 ${entry.name}`}
      description={entry.description}
      size="md"
      onClose={onClose}
      footer={
        <>
          <span className="mr-auto text-2xs text-ink-muted">
            {alreadyInstalled ? "同 ID 的服务器已存在，安装会覆盖其配置" : "保存后自动连接并测试"}
          </span>
          <Button onClick={onClose} disabled={saving}>
            取消
          </Button>
          <Button variant="primary" onClick={() => void save()} disabled={saving}>
            {saving ? "安装中…" : alreadyInstalled ? "覆盖安装" : "安装"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone={entry.transport === "http" ? "info" : "neutral"}>
            {entry.transport === "http" ? "HTTP" : "stdio"}
          </Badge>
          {entry.verified && <Badge tone="success">已验证</Badge>}
          {(entry.categories ?? []).map((category) => (
            <Badge key={category}>{category}</Badge>
          ))}
          {entry.author && <span className="text-2xs text-ink-muted">by {entry.author}</span>}
        </div>

        {(entry.requiredEnv ?? []).length === 0 ? (
          <p className="text-xs text-ink-muted">这个服务器不需要额外配置，直接安装即可。</p>
        ) : (
          <div className="flex flex-col gap-3">
            {(entry.requiredEnv ?? []).map((spec) => (
              <Field
                key={spec.name}
                label={`${spec.name}${spec.optional ? "（可选）" : ""}`}
                htmlFor={`catalog-${spec.name}`}
                hint={spec.description}
              >
                <input
                  id={`catalog-${spec.name}`}
                  className={inputClass}
                  value={values[spec.name] ?? ""}
                  placeholder={spec.defaultValue || spec.name}
                  onChange={(event) =>
                    setValues((current) => ({ ...current, [spec.name]: event.target.value }))
                  }
                />
              </Field>
            ))}
          </div>
        )}

        <div>
          <div className="mb-1 text-xs font-medium text-ink-soft">将执行的配置</div>
          <pre
            className={`max-h-32 overflow-auto whitespace-pre-wrap break-all rounded-control border px-3 py-2 text-2xs ${
              previewFailed ? "border-danger text-danger" : "border-line bg-canvas text-ink-soft"
            }`}
          >
            {preview}
          </pre>
        </div>

        {entry.prerequisites?.length ? (
          <ul className="list-disc pl-4 text-2xs text-ink-muted">
            {entry.prerequisites.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        ) : null}
        {entry.notes && <p className="text-2xs text-ink-muted">{entry.notes}</p>}
        {error && <p className="text-xs text-danger">{error}</p>}
      </div>
    </Modal>
  );
}
