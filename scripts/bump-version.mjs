#!/usr/bin/env node
/**
 * 打包前自动递增补丁版本号。
 *
 * - 更新 package.json 的 version（electron-builder 用它生成产物名与 app.getVersion()）
 * - 同步 package-lock.json 顶层的 version 字段
 *
 * 只在打包脚本中调用；`npm run build` 不会改动版本号。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkgFile = join(root, "package.json");
const pkg = JSON.parse(readFileSync(pkgFile, "utf8"));

const match = /^(\d+)\.(\d+)\.(\d+)/.exec(String(pkg.version ?? ""));
if (!match) {
  console.error(`[version] 无法解析当前版本号: ${pkg.version}`);
  process.exit(1);
}

const previous = match[0];
const next = `${match[1]}.${match[2]}.${Number(match[3]) + 1}`;
pkg.version = next;
writeFileSync(pkgFile, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");

const lockFile = join(root, "package-lock.json");
try {
  const lock = JSON.parse(readFileSync(lockFile, "utf8"));
  lock.version = next;
  if (lock.packages?.[""]) lock.packages[""].version = next;
  writeFileSync(lockFile, `${JSON.stringify(lock, null, 2)}\n`, "utf8");
} catch {
  // package-lock.json 不存在或不可读时忽略，不影响打包。
}

console.log(`[version] ${previous} -> ${next}`);
