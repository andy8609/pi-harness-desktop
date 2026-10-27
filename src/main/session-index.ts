import { createReadStream, existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve as resolvePath } from "node:path";
import { createInterface } from "node:readline";
import { SessionManager, getAgentDir } from "@earendil-works/pi-coding-agent";
import type { SessionListItem } from "@shared/types";

/**
 * 会话列表的增量索引。
 *
 * pi 的 `SessionManager.list(cwd)` 每次都会把目录里所有 jsonl 重新流式解析一遍
 * （统计 messageCount / firstMessage / modified）。桌面端在一次会话里会调用十几次
 * 刷新，大会话目录（十几 MB）每次都要 100~300ms，而且跑在主进程线程上，直接卡 UI。
 *
 * 这里按 (mtimeMs, size) 缓存每个文件的解析结果：只有真正改动的文件（通常就是
 * 当前正在写的会话）需要重解析，其余直接命中。目录本身变了（新增/删除会话）由
 * readdir 结果自然反映。
 */

interface CacheEntry {
  mtimeMs: number;
  size: number;
  item: SessionListItem | null;
}

const fileCache = new Map<string, CacheEntry>();
const PARSE_CONCURRENCY = 8;

/** 与 pi 的目录编码保持一致：`~/.pi/agent/sessions/--<cwd 转义>--`。 */
export function sessionDirFor(cwd: string, agentDir = getAgentDir()): string {
  const resolved = resolvePath(cwd);
  const safePath = `--${resolved.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
  return join(agentDir, "sessions", safePath);
}

function contentText(message: { content?: unknown }): string {
  const content = message.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((block) => block && typeof block === "object" && (block as { type?: string }).type === "text")
    .map((block) => String((block as { text?: unknown }).text ?? ""))
    .join(" ");
}

function activityTime(entry: Record<string, unknown>): number | undefined {
  const message = entry.message as Record<string, unknown> | undefined;
  if (!message || typeof message.role !== "string" || !("content" in message)) return undefined;
  if (message.role !== "user" && message.role !== "assistant") return undefined;
  if (typeof message.timestamp === "number") return message.timestamp;
  const parsed = new Date(String(entry.timestamp)).getTime();
  return Number.isNaN(parsed) ? undefined : parsed;
}

/** 逐行解析单个会话文件，产出与 `SessionManager.list` 语义一致的摘要。 */
async function parseSessionFile(
  path: string,
  fallbackModified: Date,
): Promise<SessionListItem | null> {
  const stream = createReadStream(path, { encoding: "utf8" });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  let header: Record<string, unknown> | undefined;
  let name: string | undefined;
  let messageCount = 0;
  let firstMessage = "";
  let lastActivity: number | undefined;
  try {
    for await (const line of lines) {
      if (!line.trim()) continue;
      let entry: Record<string, unknown>;
      try {
        entry = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }
      if (!entry || typeof entry !== "object") continue;
      if (!header) {
        // 第一行必须是会话头，否则和 pi 一样视为无效文件
        if (entry.type !== "session") return null;
        header = entry;
        continue;
      }
      if (entry.type === "session_info") {
        const nextName = typeof entry.name === "string" ? entry.name.trim() : "";
        name = nextName || undefined;
        continue;
      }
      if (entry.type !== "message") continue;
      messageCount += 1;
      const activity = activityTime(entry);
      if (typeof activity === "number") lastActivity = Math.max(lastActivity ?? 0, activity);
      const message = entry.message as Record<string, unknown> | undefined;
      if (!message || typeof message.role !== "string" || !("content" in message)) continue;
      if (message.role !== "user" && message.role !== "assistant") continue;
      const text = contentText(message);
      if (!text) continue;
      if (!firstMessage && message.role === "user") firstMessage = text;
    }
  } finally {
    lines.close();
    stream.close();
  }

  if (!header) return null;
  const headerTime = new Date(String(header.timestamp)).getTime();
  const modified =
    typeof lastActivity === "number" && lastActivity > 0
      ? new Date(lastActivity)
      : !Number.isNaN(headerTime)
        ? new Date(headerTime)
        : fallbackModified;
  return {
    path,
    id: String(header.id ?? ""),
    name,
    cwd: typeof header.cwd === "string" ? header.cwd : "",
    created: new Date(String(header.timestamp)).toISOString(),
    modified: modified.toISOString(),
    messageCount,
    firstMessage: firstMessage || "(no messages)",
  };
}

/**
 * 列出某个 cwd 的会话（按 modified 倒序）。目录不存在时返回空数组，与 pi 行为一致。
 * 只重新解析 mtime/size 变化的文件，其余走缓存。
 */
export async function listSessionsFast(cwd: string, agentDir?: string): Promise<SessionListItem[]> {
  const dir = sessionDirFor(cwd, agentDir);
  if (!existsSync(dir)) return [];

  let files: string[];
  try {
    files = readdirSync(dir)
      .filter((name) => name.endsWith(".jsonl"))
      .map((name) => join(dir, name));
  } catch {
    return [];
  }

  const pending: Array<{ path: string; mtimeMs: number; size: number; mtime: Date }> = [];
  const nextCache = new Map<string, CacheEntry>();
  const items: SessionListItem[] = [];

  for (const path of files) {
    let stats;
    try {
      stats = statSync(path);
    } catch {
      continue; // 文件刚被删除
    }
    const cached = fileCache.get(path);
    if (cached && cached.mtimeMs === stats.mtimeMs && cached.size === stats.size) {
      nextCache.set(path, cached);
      if (cached.item) items.push(cached.item);
      continue;
    }
    pending.push({ path, mtimeMs: stats.mtimeMs, size: stats.size, mtime: stats.mtime });
  }

  const queue = [...pending];
  const worker = async () => {
    for (;;) {
      const job = queue.shift();
      if (!job) return;
      let item: SessionListItem | null = null;
      try {
        item = await parseSessionFile(job.path, job.mtime);
      } catch {
        item = null;
      }
      nextCache.set(job.path, { mtimeMs: job.mtimeMs, size: job.size, item });
      if (item) items.push(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARSE_CONCURRENCY, queue.length) }, worker));

  // 用本轮结果替换缓存：已删除会话的条目自动淘汰
  fileCache.clear();
  for (const [path, entry] of nextCache) fileCache.set(path, entry);

  return items.sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime());
}

interface TreeCacheEntry {
  mtimeMs: number;
  size: number;
  tree: unknown[];
}

const treeCache = new Map<string, TreeCacheEntry>();

/**
 * 读历史会话的树结构（不修改内存态）。
 * 每次打开都要全量解析 jsonl，会话页反复点选同一会话时按 mtime/size 直接回车缓存值。
 */
export function readSessionTree(path: string): unknown[] {
  const stats = statSync(path);
  const cached = treeCache.get(path);
  if (cached && cached.mtimeMs === stats.mtimeMs && cached.size === stats.size) return cached.tree;
  const tree = SessionManager.open(path).getTree() as unknown[];
  treeCache.set(path, { mtimeMs: stats.mtimeMs, size: stats.size, tree });
  return tree;
}

/** 测试用：清空缓存。 */
export function clearSessionIndexCache(): void {
  fileCache.clear();
  treeCache.clear();
}
