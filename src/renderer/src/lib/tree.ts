import type { FlatTreeNode, TreeNode } from "@shared/types";

/**
 * 把主进程返回的扁平节点表重建为树。
 *
 * 输入保证「父节点先于子节点」（`flattenTree` 使用前序深度优先），
 * 因此一次遍历即可完成挂载，且顺序与原树一致。
 *
 * 容错：父节点缺失或 id 为空的节点会被提升为根，保证不丢节点。
 */
export function buildTree(flat: FlatTreeNode[]): TreeNode[] {
  if (!Array.isArray(flat) || flat.length === 0) return [];

  const entries = flat.map((item) => ({
    item,
    node: {
      id: item.id,
      type: item.type,
      timestamp: item.timestamp,
      label: item.label,
      summary: item.summary,
      children: [],
    } satisfies TreeNode,
  }));

  const byId = new Map<string, TreeNode>();
  for (const { item, node } of entries) {
    if (item.id) byId.set(item.id, node);
  }

  const roots: TreeNode[] = [];
  for (const { item, node } of entries) {
    const parent = item.parentId ? byId.get(item.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }

  return roots;
}
