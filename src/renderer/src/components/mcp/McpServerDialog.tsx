import { Plus, Trash, Eye, EyeSlash } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import {
  normalizeMcpServerInput,
  joinArgs,
  splitArgs,
  type McpScope,
  type McpServerInput,
  type McpServerRecord,
  type McpServerStatus,
  type McpTransport,
} from "@shared/mcp";
import { useAppStore } from "../../stores/app-store";
import {
  Badge,
  Button,
  Field,
  IconButton,
  Modal,
  SegmentedControl,
  Switch,
  inputClass,
  textareaClass,
} from "../ui";

type Pair = { key: string; value: string };

function recordToPairs(record: Record<string, string> | undefined): Pair[] {
  return Object.entries(record ?? {}).map(([key, value]) => ({ key, value }));
}

function pairsToRecord(pairs: Pair[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of pairs) {
    const key = pair.key.trim();
    if (key) out[key] = pair.value;
  }
  return out;
}

/**
 * 新增/编辑 MCP 服务器。
 *
 * 校验复用 `@shared/mcp` 的 `normalizeMcpServerInput`，与主进程落盘规则完全一致，
 * 避免「前端放过、后端拒绝」的两套规则。
 */
export function McpServerDialog({
  record,
  onClose,
  onSaved,
}: {
  record?: McpServerRecord;
  onClose: () => void;
  onSaved: () => void;
}) {
  const pushToast = useAppStore((state) => state.pushToast);
  const editing = Boolean(record);

  const [id, setId] = useState(record?.id ?? "");
  const [label, setLabel] = useState(record?.label ?? "");
  const [description, setDescription] = useState(record?.description ?? "");
  const [transport, setTransport] = useState<McpTransport>(record?.transport ?? "stdio");
  const [command, setCommand] = useState(record?.command ?? "");
  const [args, setArgs] = useState(joinArgs(record?.args));
  const [env, setEnv] = useState<Pair[]>(recordToPairs(record?.env));
  const [url, setUrl] = useState(record?.url ?? "");
  const [headers, setHeaders] = useState<Pair[]>(recordToPairs(record?.headers));
  const [enabled, setEnabled] = useState(record?.enabled ?? true);
  const [scopeMode, setScopeMode] = useState<"global" | "projects">(record?.scope.mode ?? "global");
  const [projects, setProjects] = useState((record?.scope.projects ?? []).join("\n"));
  const [revealSecrets, setRevealSecrets] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState("");
  const [testResult, setTestResult] = useState<McpServerStatus | null>(null);

  const scope = useMemo<McpScope>(() => {
    if (scopeMode === "global") return { mode: "global", projects: [] };
    return {
      mode: "projects",
      projects: projects
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean),
    };
  }, [scopeMode, projects]);

  const buildInput = (): McpServerInput => {
    const base = {
      id: id.trim(),
      label: label.trim() || id.trim(),
      description: description.trim() || undefined,
      transport,
      enabled,
      scope,
      ...(record?.disabledTools?.length ? { disabledTools: record.disabledTools } : {}),
    };
    if (transport === "http") {
      return { ...base, url: url.trim(), headers: pairsToRecord(headers) };
    }
    return {
      ...base,
      command: command.trim(),
      args: splitArgs(args),
      env: pairsToRecord(env),
    };
  };

  const save = async () => {
    const input = buildInput();
    const checked = normalizeMcpServerInput(input, { now: new Date().toISOString() });
    if (!checked.ok) {
      setError(checked.error);
      return;
    }
    setError("");
    setSaving(true);
    try {
      const result = await window.pi.mcpUpsert(input);
      if (result.cancelled) {
        pushToast("warning", "未确认命令，服务器没有启用");
        onClose();
        return;
      }
      pushToast("info", editing ? "已更新 MCP 服务器" : "已添加 MCP 服务器");
      onSaved();
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      setError(message);
      pushToast("error", message);
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    if (!record) return;
    setTesting(true);
    try {
      const result = await window.pi.mcpTest(record.id);
      setTestResult(result.status);
      pushToast(result.status.state === "ready" ? "info" : "error",
        result.status.state === "ready" ? `连接成功，发现 ${result.status.toolCount} 个工具` : result.status.message ?? "连接失败");
    } catch (caught) {
      pushToast("error", caught instanceof Error ? caught.message : String(caught));
    } finally {
      setTesting(false);
    }
  };

  return (
    <Modal
      title={editing ? `编辑 ${record?.label}` : "新增 MCP 服务器"}
      description={
        editing
          ? "修改连接信息后保存会立即重连；仅改名称不会打断现有连接。"
          : "stdio 服务器会在本机启动进程；HTTP 服务器只发起网络请求。"
      }
      size="lg"
      onClose={onClose}
      footer={
        <>
          <span className="mr-auto text-2xs text-ink-muted">
            {editing ? "保存后自动测试连接" : "首次启用 stdio 服务器会请求确认命令"}
          </span>
          <Button onClick={onClose} disabled={saving}>
            取消
          </Button>
          {editing && (
            <Button onClick={() => void test()} disabled={testing || saving}>
              {testing ? "测试中…" : "测试连接"}
            </Button>
          )}
          <Button variant="primary" onClick={() => void save()} disabled={saving}>
            {saving ? "保存中…" : "保存"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="ID" htmlFor="mcp-id" hint="字母开头，可含数字、下划线、连字符" error={error && !id.trim() ? error : undefined}>
            <input
              id="mcp-id"
              className={inputClass}
              value={id}
              disabled={editing}
              placeholder="filesystem"
              onChange={(event) => setId(event.target.value)}
            />
          </Field>
          <Field label="显示名称" htmlFor="mcp-label" hint="留空时使用 ID">
            <input
              id="mcp-label"
              className={inputClass}
              value={label}
              placeholder="Filesystem"
              onChange={(event) => setLabel(event.target.value)}
            />
          </Field>
        </div>

        <Field label="传输方式" htmlFor="mcp-transport">
          <SegmentedControl
            ariaLabel="传输方式"
            value={transport}
            onChange={(next) => setTransport(next)}
            options={[
              { id: "stdio", label: "stdio（本机进程）" },
              { id: "http", label: "HTTP（远程）" },
            ]}
          />
        </Field>

        {transport === "stdio" ? (
          <>
            <Field label="命令" htmlFor="mcp-command" hint="PATH 中的命令名或绝对路径；不支持相对路径">
              <input
                id="mcp-command"
                className={inputClass}
                value={command}
                placeholder="npx"
                onChange={(event) => setCommand(event.target.value)}
              />
            </Field>
            <Field
              label="参数"
              htmlFor="mcp-args"
              hint={'按命令行写法填写，含空格的参数用引号，例如 -y pkg "D:/my docs"'}
            >
              <input
                id="mcp-args"
                className={inputClass}
                value={args}
                placeholder="-y @modelcontextprotocol/server-filesystem D:/work"
                onChange={(event) => setArgs(event.target.value)}
              />
            </Field>
            <KeyValueEditor
              label="环境变量"
              keyPlaceholder="LOG_LEVEL"
              valuePlaceholder="info"
              pairs={env}
              onChange={setEnv}
              reveal={revealSecrets}
            />
          </>
        ) : (
          <>
            <Field label="URL" htmlFor="mcp-url" hint="只支持 http / https，通常以 /mcp 结尾">
              <input
                id="mcp-url"
                className={inputClass}
                value={url}
                placeholder="https://mcp.example.com/mcp"
                onChange={(event) => setUrl(event.target.value)}
              />
            </Field>
            <div className="flex items-center justify-between">
              <span className="text-xs text-ink-muted">请求头（Authorization 等凭据建议填在这里）</span>
              <Button
                size="sm"
                variant="ghost"
                icon={revealSecrets ? <EyeSlash size={12} /> : <Eye size={12} />}
                onClick={() => setRevealSecrets((current) => !current)}
              >
                {revealSecrets ? "隐藏值" : "显示值"}
              </Button>
            </div>
            <KeyValueEditor
              label="请求头"
              keyPlaceholder="Authorization"
              valuePlaceholder="Bearer …"
              pairs={headers}
              onChange={setHeaders}
              reveal={revealSecrets}
            />
          </>
        )}

        <Field label="描述" htmlFor="mcp-description" hint="可选，帮助模型判断何时使用这些工具">
          <input
            id="mcp-description"
            className={inputClass}
            value={description}
            placeholder="本地文件读写"
            onChange={(event) => setDescription(event.target.value)}
          />
        </Field>

        <div className="flex items-center justify-between rounded-control border border-line px-3 py-2">
          <div>
            <div className="text-sm text-ink">启用</div>
            <p className="text-2xs text-ink-muted">停用后不连接、不注册工具，但保留配置。</p>
          </div>
          <Switch checked={enabled} onChange={setEnabled} label="启用服务器" />
        </div>

        <Field label="激活范围" htmlFor="mcp-scope">
          <SegmentedControl
            ariaLabel="激活范围"
            size="sm"
            value={scopeMode}
            onChange={(next) => setScopeMode(next)}
            options={[
              { id: "global", label: "所有项目" },
              { id: "projects", label: "指定项目" },
            ]}
          />
        </Field>
        {scopeMode === "projects" && (
          <Field
            label="项目路径"
            htmlFor="mcp-projects"
            hint="每行一个绝对路径；只在打开这些项目时连接。"
          >
            <textarea
              id="mcp-projects"
              className={`${textareaClass} h-20 font-mono text-xs`}
              value={projects}
              placeholder="D:/work/a"
              onChange={(event) => setProjects(event.target.value)}
            />
          </Field>
        )}

        {error && id.trim() && <p className="text-xs text-danger">{error}</p>}

        {testResult && (
          <div className="flex items-center gap-2 rounded-control bg-surface-muted px-3 py-2 text-xs">
            <Badge tone={testResult.state === "ready" ? "success" : "danger"}>
              {testResult.state === "ready" ? "连接成功" : "连接失败"}
            </Badge>
            <span className="text-ink-muted">
              {testResult.state === "ready"
                ? `发现 ${testResult.toolCount} 个工具`
                : testResult.message ?? "未知错误"}
            </span>
          </div>
        )}
      </div>
    </Modal>
  );
}

function KeyValueEditor({
  label,
  keyPlaceholder,
  valuePlaceholder,
  pairs,
  onChange,
  reveal,
}: {
  label: string;
  keyPlaceholder: string;
  valuePlaceholder: string;
  pairs: Pair[];
  onChange: (next: Pair[]) => void;
  reveal: boolean;
}) {
  const update = (index: number, patch: Partial<Pair>) => {
    onChange(pairs.map((pair, current) => (current === index ? { ...pair, ...patch } : pair)));
  };
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-ink-soft">{label}</span>
        <Button size="sm" variant="ghost" icon={<Plus size={12} />} onClick={() => onChange([...pairs, { key: "", value: "" }])}>
          添加
        </Button>
      </div>
      {pairs.length === 0 ? (
        <p className="text-2xs text-ink-muted">没有条目。点「添加」新增一行。</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {pairs.map((pair, index) => (
            <li key={index} className="flex items-center gap-1.5">
              <input
                className={inputClass}
                value={pair.key}
                placeholder={keyPlaceholder}
                aria-label={`${label}键 ${index + 1}`}
                onChange={(event) => update(index, { key: event.target.value })}
              />
              <input
                className={inputClass}
                type={reveal ? "text" : "password"}
                value={pair.value}
                placeholder={valuePlaceholder}
                aria-label={`${label}值 ${index + 1}`}
                onChange={(event) => update(index, { value: event.target.value })}
              />
              <IconButton
                size="sm"
                variant="danger"
                label={`删除第 ${index + 1} 行${label}`}
                onClick={() => onChange(pairs.filter((_, current) => current !== index))}
              >
                <Trash size={13} />
              </IconButton>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
