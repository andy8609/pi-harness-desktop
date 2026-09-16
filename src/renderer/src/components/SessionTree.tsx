import { CaretDown, CaretRight } from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";
import type { TreeNode } from "@shared/types";

export type TreeFilterMode = "default" | "no-tools" | "user-only" | "all";

const SETTINGS_TYPES = new Set(["custom", "model_change", "thinking_level_change", "label", "session_info"]);

const FILTERS: Array<{ id: TreeFilterMode; label: string }> = [
  { id: "default", label: "默认" },
  { id: "no-tools", label: "无工具" },
  { id: "user-only", label: "仅用户" },
  { id: "all", label: "全部" },
];

function isUserNode(node: TreeNode): boolean {
  return node.type === "message" && node.summary.startsWith("user:");
}

function isToolResultNode(node: TreeNode): boolean {
  return node.type === "message" && node.summary.startsWith("toolResult:");
}

function isAssistantToolOnly(node: TreeNode): boolean {
  if (node.type !== "message" || !node.summary.startsWith("assistant:")) return false;
  const rest = node.summary.slice("assistant:".length).trim();
  const stripped = rest.replace(/\[thinking\]/g, "").replace(/\[tool [^\]]*\]/g, "").trim();
  return stripped.length === 0;
}

function isVisible(node: TreeNode, mode: TreeFilterMode): boolean {
  switch (mode) {
    case "all":
      return true;
    case "user-only":
      return isUserNode(node);
    case "no-tools":
      return !SETTINGS_TYPES.has(node.type) && !isToolResultNode(node) && !isAssistantToolOnly(node);
    default:
      return !SETTINGS_TYPES.has(node.type) && !isAssistantToolOnly(node);
  }
}

function filterForest(nodes: TreeNode[], mode: TreeFilterMode): TreeNode[] {
  const out: TreeNode[] = [];
  for (const node of nodes) {
    const children = filterForest(node.children, mode);
    if (isVisible(node, mode)) {
      out.push({ ...node, children });
    } else {
      out.push(...children);
    }
  }
  return out;
}

function collectBranchIds(nodes: TreeNode[], into: Set<string> = new Set()): Set<string> {
  for (const node of nodes) {
    if (node.children.length > 1) into.add(node.id);
    collectBranchIds(node.children, into);
  }
  return into;
}

const GUIDE = "border-[#8a8468]";

function NodeRow({
  node,
  selected,
  isBranch,
  isCollapsed,
  onToggle,
  onSelect,
  onNavigate,
  onFork,
}: {
  node: TreeNode;
  selected: boolean;
  isBranch: boolean;
  isCollapsed: boolean;
  onToggle: (id: string) => void;
  onSelect: (id: string) => void;
  onNavigate: (id: string) => void;
  onFork: (id: string) => void;
}) {
  return (
    <div className={`mb-0.5 flex items-start gap-1 rounded-md px-1 py-1 ${selected ? "bg-[#22261c]" : ""}`}>
      {isBranch ? (
        <button
          className="mt-0.5 shrink-0 text-[#9a937c] hover:text-[#c4d45a]"
          title={isCollapsed ? "展开旁支" : "折叠旁支"}
          onClick={(event) => {
            event.stopPropagation();
            onToggle(node.id);
          }}
        >
          {isCollapsed ? <CaretRight size={12} /> : <CaretDown size={12} />}
        </button>
      ) : (
        <span className="mt-0.5 inline-block w-3 shrink-0" />
      )}
      <button
        className={`min-w-0 flex-1 text-left text-sm hover:text-[#c4d45a] ${selected ? "text-[#c4d45a]" : ""}`}
        onClick={() => onSelect(node.id)}
        onDoubleClick={() => onNavigate(node.id)}
      >
        <div className="text-[11px] text-[#9a937c]">{node.type}</div>
        <div className="break-words">{node.label || node.summary}</div>
      </button>
      {isUserNode(node) && (
        <button
          className="shrink-0 text-xs text-[#c4d45a]"
          onClick={(event) => {
            event.stopPropagation();
            onFork(node.id);
          }}
        >
          fork
        </button>
      )}
      {selected && (
        <button
          className="shrink-0 text-xs text-[#c4d45a]"
          onClick={(event) => {
            event.stopPropagation();
            onNavigate(node.id);
          }}
        >
          跳转
        </button>
      )}
    </div>
  );
}

function TreeChildren({
  nodes,
  collapsed,
  selectedId,
  onToggle,
  onSelect,
  onNavigate,
  onFork,
}: {
  nodes: TreeNode[];
  collapsed: Set<string>;
  selectedId?: string;
  onToggle: (id: string) => void;
  onSelect: (id: string) => void;
  onNavigate: (id: string) => void;
  onFork: (id: string) => void;
}) {
  if (nodes.length === 0) return null;
  if (nodes.length === 1) {
    return (
      <NodeView
        node={nodes[0]}
        collapsed={collapsed}
        selectedId={selectedId}
        onToggle={onToggle}
        onSelect={onSelect}
        onNavigate={onNavigate}
        onFork={onFork}
      />
    );
  }
  return (
    <div className={`ml-2 border-l border-dashed ${GUIDE}`}>
      {nodes.map((child, index) => {
        const last = index === nodes.length - 1;
        return (
          <div key={child.id} className="relative pl-3">
            <span className={`pointer-events-none absolute top-[13px] left-0 w-3 border-t border-dashed ${GUIDE}`} />
            {last && <span className="pointer-events-none absolute top-[14px] bottom-0 -left-px w-px bg-[#1a1d16]" />}
            <NodeView
              node={child}
              collapsed={collapsed}
              selectedId={selectedId}
              onToggle={onToggle}
              onSelect={onSelect}
              onNavigate={onNavigate}
              onFork={onFork}
            />
          </div>
        );
      })}
    </div>
  );
}

function NodeView({
  node,
  collapsed,
  selectedId,
  onToggle,
  onSelect,
  onNavigate,
  onFork,
}: {
  node: TreeNode;
  collapsed: Set<string>;
  selectedId?: string;
  onToggle: (id: string) => void;
  onSelect: (id: string) => void;
  onNavigate: (id: string) => void;
  onFork: (id: string) => void;
}) {
  const isBranch = node.children.length > 1;
  const isCollapsed = isBranch && collapsed.has(node.id);
  const selected = selectedId === node.id;

  return (
    <div>
      <NodeRow
        node={node}
        selected={selected}
        isBranch={isBranch}
        isCollapsed={isCollapsed}
        onToggle={onToggle}
        onSelect={onSelect}
        onNavigate={onNavigate}
        onFork={onFork}
      />
      {!isCollapsed && (
        <TreeChildren
          nodes={node.children}
          collapsed={collapsed}
          selectedId={selectedId}
          onToggle={onToggle}
          onSelect={onSelect}
          onNavigate={onNavigate}
          onFork={onFork}
        />
      )}
    </div>
  );
}

export function SessionTree({
  nodes,
  onNavigate,
  onFork,
}: {
  nodes: TreeNode[];
  onNavigate: (id: string) => void;
  onFork: (id: string) => void;
}) {
  const [mode, setMode] = useState<TreeFilterMode>("default");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string>();

  const forest = useMemo(() => filterForest(nodes, mode), [nodes, mode]);
  const branchIds = useMemo(() => collectBranchIds(forest), [forest]);

  useEffect(() => {
    setCollapsed(new Set());
    setSelectedId(undefined);
  }, [nodes]);

  if (nodes.length === 0) {
    return <div className="text-sm text-[#9a937c]">打开项目后可查看当前会话树。</div>;
  }

  return (
    <div className="rounded-xl border border-[#33392a] bg-[#1a1d16] p-3">
      <div className="mb-3 flex flex-wrap items-center gap-1">
        {FILTERS.map((filter) => (
          <button
            key={filter.id}
            className={`rounded px-2 py-0.5 text-xs ${
              mode === filter.id ? "bg-[#c4d45a] text-[#16180f]" : "border border-[#33392a] text-[#cfc8b0]"
            }`}
            onClick={() => setMode(filter.id)}
          >
            {filter.label}
          </button>
        ))}
        <span className="mx-1 h-3 w-px bg-[#33392a]" />
        <button
          className="rounded border border-[#33392a] px-2 py-0.5 text-xs text-[#cfc8b0]"
          onClick={() => setCollapsed(new Set())}
        >
          全部展开
        </button>
        <button
          className="rounded border border-[#33392a] px-2 py-0.5 text-xs text-[#cfc8b0]"
          onClick={() => setCollapsed(new Set(branchIds))}
        >
          全部折叠
        </button>
      </div>
      {forest.length === 0 ? (
        <div className="text-sm text-[#9a937c]">该筛选下没有节点。可切换到「全部」查看记账条目。</div>
      ) : (
        <TreeChildren
          nodes={forest}
          collapsed={collapsed}
          selectedId={selectedId}
          onToggle={(id) => {
            setCollapsed((prev) => {
              const next = new Set(prev);
              if (next.has(id)) next.delete(id);
              else next.add(id);
              return next;
            });
          }}
          onSelect={setSelectedId}
          onNavigate={onNavigate}
          onFork={onFork}
        />
      )}
    </div>
  );
}
