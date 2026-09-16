import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import type { FileSearchResult } from "@shared/types";

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

export function searchProjectFiles(cwd: string, query: string, limit = 30): FileSearchResult[] {
  if (!cwd || !existsSync(cwd)) return [];
  const needle = query.trim().toLowerCase();
  const results: FileSearchResult[] = [];

  const walk = (dir: string): void => {
    if (results.length >= limit) return;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      if (results.length >= limit) return;
      if (SKIP.has(name) || name.startsWith(".")) continue;
      const full = join(dir, name);
      let stat;
      try {
        stat = statSync(full);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        walk(full);
        continue;
      }
      const rel = relative(cwd, full).split(sep).join("/");
      if (!needle || rel.toLowerCase().includes(needle) || name.toLowerCase().includes(needle)) {
        results.push({ path: full, relative: rel });
      }
    }
  };

  walk(cwd);
  return results;
}
