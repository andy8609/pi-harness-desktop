import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type { FileContent, FileEntry } from "@shared/types";

/** Directories that are never worth showing in the work panel file tree. */
const SKIP = new Set([
  "node_modules",
  ".git",
  "dist",
  "out",
  "release",
  ".next",
  "coverage",
  ".turbo",
  ".cache",
]);

const MAX_DIR_ENTRIES = 800;
const MAX_FILE_BYTES = 256 * 1024;

/**
 * Resolve a user-supplied path against `cwd`, refusing anything that escapes it.
 * The work panel must never be able to read arbitrary files on disk.
 */
export function resolveInsideRoot(cwd: string, relPath: string): string {
  if (!cwd) throw new Error("尚未打开项目目录");
  const root = resolve(cwd);
  const target = isAbsolute(relPath) ? resolve(relPath) : resolve(root, relPath || ".");
  const rel = relative(root, target);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error("路径超出项目目录范围");
  }
  return target;
}

function toRelative(cwd: string, fullPath: string): string {
  return relative(cwd, fullPath).split(sep).join("/");
}

export function listDirectory(cwd: string, relPath = ""): FileEntry[] {
  const dir = resolveInsideRoot(cwd, relPath);
  if (!existsSync(dir)) return [];
  const stat = statSync(dir);
  if (!stat.isDirectory()) return [];
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const entries: FileEntry[] = [];
  for (const name of names) {
    if (entries.length >= MAX_DIR_ENTRIES) break;
    if (SKIP.has(name)) continue;
    const full = join(dir, name);
    let isDir = false;
    try {
      isDir = statSync(full).isDirectory();
    } catch {
      continue;
    }
    entries.push({ name, path: full, relative: toRelative(cwd, full), isDir });
  }
  // Directories first, then case-insensitive name order.
  entries.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
  return entries;
}

export function readFileText(cwd: string, relPath: string): FileContent {
  const full = resolveInsideRoot(cwd, relPath);
  const relativePath = toRelative(cwd, full);
  if (!existsSync(full)) throw new Error("文件不存在");
  const stat = statSync(full);
  if (stat.isDirectory()) throw new Error("这是一个目录");
  const buffer = readFileSync(full);
  const binary = buffer.subarray(0, 8000).includes(0);
  if (binary) {
    return { path: full, relative: relativePath, content: "", truncated: false, binary: true };
  }
  const truncated = buffer.length > MAX_FILE_BYTES;
  const slice = truncated ? buffer.subarray(0, MAX_FILE_BYTES) : buffer;
  return {
    path: full,
    relative: relativePath,
    content: slice.toString("utf8"),
    truncated,
    binary: false,
  };
}
