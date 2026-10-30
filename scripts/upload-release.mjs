#!/usr/bin/env node
/**
 * 将 release/ 目录下的打包产物上传到 GitHub Releases。
 *
 * 用法：
 *   GH_TOKEN=xxx node scripts/upload-release.mjs
 *   node scripts/upload-release.mjs --dry-run
 *   node scripts/upload-release.mjs --only latest.yml
 *   token 也可放在 %USERPROFILE%\.pi-gh-token
 *
 * 为什么用 curl 而不是 Node fetch：
 *   本机链路对 TLS 1.3 握手会 RST（ECONNRESET），Node 默认优先 TLS 1.3 导致
 *   所有请求失败；Windows 自带 curl(Schannel) 能正常协商，因此 HTTP 层统一走 curl。
 *
 * 其他要点：
 * - 资产名统一把空格替换成连字符，与 latest.yml 中的 URL 保持一致（否则自动更新 404）
 * - 若同名资产已存在，先删除再上传（幂等重跑）
 * - 自带重试（curl --retry + JS 层兜底）
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const OWNER = "andy8609";
const REPO = "pi-harness-desktop";
const TAG = "v0.1.1";
const VERSION = "0.1.1";
const RELEASE_DIR = join(import.meta.dirname, "..", "release");

const DRY_RUN = process.argv.includes("--dry-run");
// --only a,b  只处理指定文件（用于分批重试，避免大包白跑）
const ONLY = (() => {
  const i = process.argv.indexOf("--only");
  if (i === -1) return null;
  const raw = process.argv[i + 1];
  if (!raw) throw new Error("--only 需要一个参数，例如 --only latest.yml");
  return new Set(raw.split(",").map((s) => s.trim()).filter(Boolean));
})();

const FILES = [
  `Pi Desktop-${VERSION}-mac-arm64.dmg`,
  `Pi Desktop-${VERSION}-mac-arm64.zip`,
  `Pi Desktop-${VERSION}-mac-x64.dmg`,
  `Pi Desktop-${VERSION}-mac-x64.zip`,
  `Pi Desktop-${VERSION}-win-x64.exe`,
  `Pi Desktop-${VERSION}-win-x64.exe.blockmap`,
  `Pi Desktop-${VERSION}-win-x64.zip`,
  "latest.yml",
];

const RELEASE_BODY = `## Pi Desktop ${VERSION}

Pi coding agent 桌面客户端首个公开发布版本。

### 下载

| 平台 | 文件 |
| --- | --- |
| Windows x64（安装包） | \`Pi-Desktop-${VERSION}-win-x64.exe\` |
| Windows x64（免安装 zip） | \`Pi-Desktop-${VERSION}-win-x64.zip\` |
| macOS Apple Silicon（dmg） | \`Pi-Desktop-${VERSION}-mac-arm64.dmg\` |
| macOS Apple Silicon（zip） | \`Pi-Desktop-${VERSION}-mac-arm64.zip\` |
| macOS Intel（dmg） | \`Pi-Desktop-${VERSION}-mac-x64.dmg\` |
| macOS Intel（zip） | \`Pi-Desktop-${VERSION}-mac-x64.zip\` |

### 安装提示

- **macOS 未签名 / 未公证**：首次打开请右键 → 打开；或执行
  \`xattr -dr com.apple.quarantine "/Applications/Pi Desktop.app"\`
- **Windows 安装包未做代码签名**：SmartScreen 可能提示，选择「仍要运行」。
- \`latest.yml\` 供 electron-updater 自动更新使用，请勿手动修改。

### 本版要点

- 新增 MCP 支持
- 模型配置优化
- 会话历史优化
- 界面与功能细节优化
`;

// Windows 自带 curl（Schannel）规避本机 TLS 1.3 被 RST 的问题
const CURL_CANDIDATES = [
  join(process.env.SystemRoot ?? "C:\\Windows", "System32", "curl.exe"),
  "/c/Windows/System32/curl.exe",
];
const CURL = CURL_CANDIDATES.find((p) => existsSync(p)) ?? "curl";

function readToken() {
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN.trim();
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN.trim();
  const file = join(homedir(), ".pi-gh-token");
  if (existsSync(file)) return readFileSync(file, "utf8").trim();
  return "";
}

const TOKEN = readToken();
if (!TOKEN && !DRY_RUN) {
  console.error("[token] 未找到凭据：请设置 GH_TOKEN 或创建 %USERPROFILE%\\.pi-gh-token");
  process.exit(1);
}

/** 执行 curl，返回 stdout；失败抛错 */
function curl(args, { timeoutSec = 120, inheritStderr = false, label = "" } = {}) {
  const full = ["-sS", "--max-time", String(timeoutSec), ...args];
  const res = spawnSync(CURL, full, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", inheritStderr ? "inherit" : "pipe"],
  });
  if (res.error) throw new Error(`curl 启动失败: ${res.error.message}`);
  const stdout = res.stdout ?? "";
  if (res.status !== 0) {
    const stderr = inheritStderr ? "" : (res.stderr ?? "").slice(0, 400);
    throw new Error(`${label || "curl"} 失败 (exit ${res.status}): ${stderr || stdout.slice(0, 400)}`);
  }
  return stdout;
}

function apiJson(method, path, body) {
  const args = [
    "-X", method,
    "-H", `Authorization: Bearer ${TOKEN}`,
    "-H", "Accept: application/vnd.github+json",
    "-H", "X-GitHub-Api-Version: 2022-11-28",
    "-H", "User-Agent: pi-desktop-release-script",
  ];
  if (body) {
    args.push("-H", "Content-Type: application/json", "--data-binary", JSON.stringify(body));
  }
  const out = curl([...args, `https://api.github.com${path}`], { label: `${method} ${path}` });
  return out ? JSON.parse(out) : null;
}

function human(bytes) {
  const units = ["B", "KB", "MB", "GB"];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i += 1;
  }
  return `${n.toFixed(1)}${units[i]}`;
}

function uploadOnce(releaseId, filePath, assetName) {
  const url = `https://uploads.github.com/repos/${OWNER}/${REPO}/releases/${releaseId}/assets?name=${encodeURIComponent(assetName)}`;
  const out = curl(
    [
      "-X", "POST",
      "-H", `Authorization: Bearer ${TOKEN}`,
      "-H", "Accept: application/vnd.github+json",
      "-H", "Content-Type: application/octet-stream",
      "-H", "User-Agent: pi-desktop-release-script",
      "--retry", "3",
      "--retry-delay", "5",
      "--retry-all-errors",
      "-T", filePath,
      "--progress-bar",
      url,
    ],
    { timeoutSec: 7200, inheritStderr: true, label: `upload ${assetName}` },
  );
  try {
    return JSON.parse(out);
  } catch {
    return { raw: out };
  }
}

async function uploadWithRetry(releaseId, filePath, assetName, tries = 3) {
  let lastErr;
  for (let i = 1; i <= tries; i += 1) {
    const started = Date.now();
    try {
      if (i > 1) console.log(`    重试 ${i}/${tries}: ${assetName}`);
      const res = await uploadOnce(releaseId, filePath, assetName);
      const secs = (Date.now() - started) / 1000;
      const speed = human((res.size ?? statSync(filePath).size) / (secs || 1));
      console.log(`    完成，用时 ${secs.toFixed(1)}s，均速 ${speed}/s`);
      return res;
    } catch (err) {
      lastErr = err;
      console.error(`    第 ${i} 次失败: ${err.message}`);
      if (i < tries) await new Promise((r) => setTimeout(r, 5000 * i));
    }
  }
  throw lastErr;
}

async function main() {
  // 0. 预检：本地文件 + 大小
  const local = [];
  for (const name of FILES) {
    if (ONLY && !ONLY.has(name) && !ONLY.has(name.replaceAll(" ", "-"))) continue;
    const p = join(RELEASE_DIR, name);
    if (!existsSync(p)) throw new Error(`缺少文件: ${p}`);
    local.push({ name, path: p, size: statSync(p).size, assetName: name.replaceAll(" ", "-") });
  }
  if (local.length === 0) throw new Error("--only 未匹配到任何文件");
  const total = local.reduce((a, b) => a + b.size, 0);
  console.log(`[precheck] ${local.length} 个文件，共 ${human(total)}  (curl: ${CURL})`);
  for (const f of local) console.log(`  - ${f.name} -> ${f.assetName} (${human(f.size)})`);

  if (DRY_RUN) {
    console.log("[dry-run] 不执行上传");
    return;
  }

  // 1. 确认 tag 存在
  const tagRef = apiJson("GET", `/repos/${OWNER}/${REPO}/git/ref/tags/${TAG}`);
  console.log(`[tag] ${TAG} -> ${tagRef.object.sha.slice(0, 7)}`);

  // 2. 取或创建 release
  let release = null;
  try {
    release = apiJson("GET", `/repos/${OWNER}/${REPO}/releases/tags/${TAG}`);
    console.log(`[release] 已存在: ${release.html_url}`);
  } catch {
    release = apiJson("POST", `/repos/${OWNER}/${REPO}/releases`, {
      tag_name: TAG,
      name: `Pi Desktop ${TAG}`,
      body: RELEASE_BODY,
      draft: false,
      prerelease: false,
    });
    console.log(`[release] 已创建: ${release.html_url}`);
  }

  // 3. 清理同名旧资产
  const existing = apiJson("GET", `/repos/${OWNER}/${REPO}/releases/${release.id}/assets?per_page=100`);
  const wanted = new Set(local.map((f) => f.assetName));
  for (const a of existing) {
    if (wanted.has(a.name)) {
      console.log(`[clean] 删除同名旧资产 ${a.name}`);
      apiJson("DELETE", `/repos/${OWNER}/${REPO}/releases/assets/${a.id}`);
    }
  }

  // 4. 逐个上传
  let seq = 0;
  for (const f of local) {
    seq += 1;
    console.log(`\n[upload ${seq}/${local.length}] ${f.assetName} (${human(f.size)})`);
    await uploadWithRetry(release.id, f.path, f.assetName);
  }

  // 5. 校验
  const finalAssets = apiJson("GET", `/repos/${OWNER}/${REPO}/releases/${release.id}/assets?per_page=100`);
  console.log("\n=== 最终资产清单 ===");
  const byName = new Map(finalAssets.map((a) => [a.name, a]));
  let allOk = true;
  for (const f of local) {
    const a = byName.get(f.assetName);
    const ok = a && a.size === f.size && a.state === "uploaded";
    if (!ok) allOk = false;
    const info = a ? `${human(a.size)} ${a.state}` : "缺失";
    console.log(`  ${ok ? "OK  " : "FAIL"} ${f.assetName.padEnd(40)} ${info}`);
  }
  console.log(`\nRelease: ${release.html_url}`);
  if (!allOk) {
    console.error("[warn] 存在未完成或大小不符的资产，请重跑本脚本补齐");
    process.exit(2);
  }
  console.log("[done] 全部资产校验通过");
}

main().catch((err) => {
  console.error("\n[error]", err.message);
  process.exit(1);
});
