import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { CONFIG_DIR_NAME, getAgentDir, parseFrontmatter } from "@earendil-works/pi-coding-agent";
import type { CreateResourceFileInput, ResourceCreateScope, ResourceFile, ResourceFiles } from "@shared/types";

const MAX_RESOURCE_CHARS = 256 * 1024;

export function samePath(left: string, right: string): boolean {
  return resolve(left) === resolve(right);
}

export function toResourceFile(input: {
  kind: ResourceFile["kind"];
  name: string;
  path: string;
  content: string;
  description?: string;
  argumentHint?: string;
  scope?: ResourceFile["scope"];
}): ResourceFile {
  const truncated = input.content.length > MAX_RESOURCE_CHARS;
  return {
    kind: input.kind,
    name: input.name,
    path: input.path,
    description: input.description,
    argumentHint: input.argumentHint,
    scope: input.scope,
    content: truncated ? input.content.slice(0, MAX_RESOURCE_CHARS) : input.content,
    truncated,
  };
}

export function emptyResourceFiles(): ResourceFiles {
  return { prompts: [], agentsFiles: [] };
}

function stringifyFrontmatterValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

export function writePromptTemplateFile(path: string, content: string, description?: string): void {
  const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
  const parsed = parseFrontmatter<Record<string, unknown>>(existing);
  const frontmatter = { ...parsed.frontmatter };
  if (description !== undefined) {
    const trimmed = description.trim();
    if (trimmed) frontmatter.description = trimmed;
    else delete frontmatter.description;
  }
  const keys = Object.keys(frontmatter);
  const body = content.replace(/^\uFEFF/, "");
  const text =
    keys.length > 0
      ? `---\n${keys.map((key) => `${key}: ${stringifyFrontmatterValue(frontmatter[key])}`).join("\n")}\n---\n${body.replace(/^\n/, "")}`
      : body;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, "utf8");
}

export function writeAgentsContextFile(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content.replace(/^\uFEFF/, ""), "utf8");
}

export function resourceFileName(path: string, fallback: string): string {
  return basename(path) || fallback;
}

const PROMPT_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;

export const DEFAULT_AGENTS_CONTENT = `# AGENTS.md

这个文件会作为项目上下文提供给代理。在此说明仓库结构、约定和注意事项。
`;

export function sanitizePromptName(name: string): string {
  const trimmed = name.trim().replace(/\.md$/i, "");
  if (!PROMPT_NAME_RE.test(trimmed)) {
    throw new Error("模板名称需以字母或数字开头，只能包含字母、数字、点、下划线和短横线");
  }
  return trimmed;
}

export function resolveNewResourcePath(input: {
  kind: ResourceFile["kind"];
  scope: ResourceCreateScope;
  cwd?: string;
  name?: string;
}): string {
  if (input.scope === "project" && !input.cwd) {
    throw new Error("请先打开一个项目目录");
  }
  if (input.kind === "prompt") {
    const file = `${sanitizePromptName(input.name ?? "")}.md`;
    return input.scope === "user"
      ? join(getAgentDir(), "prompts", file)
      : join(input.cwd!, CONFIG_DIR_NAME, "prompts", file);
  }
  return input.scope === "user" ? join(getAgentDir(), "AGENTS.md") : join(input.cwd!, "AGENTS.md");
}

export function createResourceFileOnDisk(input: CreateResourceFileInput & { cwd?: string }): string {
  const path = resolveNewResourcePath(input);
  if (existsSync(path)) throw new Error("该文件已存在");
  if (input.kind === "prompt") {
    writePromptTemplateFile(path, input.content ?? "", input.description);
  } else {
    writeAgentsContextFile(path, input.content ?? DEFAULT_AGENTS_CONTENT);
  }
  return path;
}
