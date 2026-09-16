import { copyFileSync, cpSync, existsSync, mkdirSync, statSync } from "node:fs";
import { basename, dirname, extname, join, relative } from "node:path";
import {
  DefaultPackageManager,
  SettingsManager,
  getAgentDir,
  type PackageSource,
  type ResolvedResource,
} from "@earendil-works/pi-coding-agent";
import type { ConfiguredPackageInfo, InstalledResource, PackageInventory, ResourceKind } from "@shared/types";

export interface PackageContext {
  cwd: string;
  agentDir: string;
  settingsManager: SettingsManager;
  pm: DefaultPackageManager;
}

export function createPackageContext(cwd: string, existing?: SettingsManager): PackageContext {
  const agentDir = getAgentDir();
  const settingsManager = existing ?? SettingsManager.create(cwd, agentDir);
  return {
    cwd,
    agentDir,
    settingsManager,
    pm: new DefaultPackageManager({ cwd, agentDir, settingsManager }),
  };
}

function toPosix(path: string): string {
  return path.replace(/\\/g, "/");
}

function displayName(kind: ResourceKind, path: string): string {
  const file = basename(path);
  const parent = basename(dirname(path));
  if (kind === "skills" && file.toLowerCase() === "skill.md") return parent;
  if (kind === "extensions" && parent !== "extensions") return `${parent}/${file}`;
  return file;
}

function toInstalled(kind: ResourceKind, resource: ResolvedResource): InstalledResource {
  const baseDir = resource.metadata.baseDir ?? dirname(resource.path);
  return {
    name: displayName(kind, resource.path),
    path: resource.path,
    enabled: resource.enabled,
    source: resource.metadata.source,
    scope: resource.metadata.scope,
    origin: resource.metadata.origin,
    packageSource: resource.metadata.origin === "package" ? resource.metadata.source : undefined,
    relativePath: toPosix(relative(baseDir, resource.path)),
    kind,
  };
}

export async function listInstalled(ctx: PackageContext): Promise<PackageInventory> {
  const resolved = await ctx.pm.resolve(async () => "skip");
  return {
    extensions: resolved.extensions.map((resource) => toInstalled("extensions", resource)),
    skills: resolved.skills.map((resource) => toInstalled("skills", resource)),
    packages: ctx.pm.listConfiguredPackages().map(
      (item): ConfiguredPackageInfo => ({
        source: item.source,
        scope: item.scope,
        filtered: item.filtered,
      }),
    ),
  };
}

function stripPattern(entry: string): string {
  return entry.startsWith("!") || entry.startsWith("+") || entry.startsWith("-") ? entry.slice(1) : entry;
}

function upsertPattern(entries: string[], pattern: string, enabled: boolean): string[] {
  const updated = entries.filter((entry) => toPosix(stripPattern(entry)) !== toPosix(pattern));
  updated.push(`${enabled ? "+" : "-"}${pattern}`);
  return updated;
}

function setTopLevelPaths(ctx: PackageContext, item: InstalledResource, paths: string[]): void {
  const project = item.scope === "project";
  if (item.kind === "extensions") {
    if (project) ctx.settingsManager.setProjectExtensionPaths(paths);
    else ctx.settingsManager.setExtensionPaths(paths);
    return;
  }
  if (project) ctx.settingsManager.setProjectSkillPaths(paths);
  else ctx.settingsManager.setSkillPaths(paths);
}

function toggleTopLevel(ctx: PackageContext, item: InstalledResource, enabled: boolean): void {
  const settings =
    item.scope === "project" ? ctx.settingsManager.getProjectSettings() : ctx.settingsManager.getGlobalSettings();
  const current = (settings[item.kind] ?? []) as string[];
  const pattern = item.relativePath || toPosix(relative(item.source === "auto" ? ctx.agentDir : dirname(item.path), item.path));
  setTopLevelPaths(ctx, item, upsertPattern(current, pattern, enabled));
}

function togglePackage(ctx: PackageContext, item: InstalledResource, enabled: boolean): void {
  const project = item.scope === "project";
  const settings = project ? ctx.settingsManager.getProjectSettings() : ctx.settingsManager.getGlobalSettings();
  const packages = [...(settings.packages ?? [])] as PackageSource[];
  const source = item.packageSource ?? item.source;
  const index = packages.findIndex((pkg) => (typeof pkg === "string" ? pkg : pkg.source) === source);
  if (index === -1) return;

  let pkg = packages[index];
  if (typeof pkg === "string") {
    pkg = { source: pkg };
    packages[index] = pkg;
  }

  const current = (pkg[item.kind] ?? []) as string[];
  const pattern = item.relativePath || basename(item.path);
  const updated = upsertPattern(current, pattern, enabled);
  pkg[item.kind] = updated;

  const hasFilters = (["extensions", "skills", "prompts", "themes"] as const).some((key) => pkg[key] !== undefined);
  if (!hasFilters) {
    packages[index] = pkg.source;
  }

  if (project) ctx.settingsManager.setProjectPackages(packages);
  else ctx.settingsManager.setPackages(packages);
}

export function toggleResource(ctx: PackageContext, item: InstalledResource, enabled: boolean): void {
  if (item.origin === "top-level") toggleTopLevel(ctx, item, enabled);
  else togglePackage(ctx, item, enabled);
}

function safeSkillName(name: string): string {
  const cleaned = name.replace(/[<>:"/\\|?*]/g, "-").trim();
  return cleaned || "skill";
}

export function importLocalSkill(sourcePath: string): string {
  if (!existsSync(sourcePath)) throw new Error(`找不到路径: ${sourcePath}`);
  const skillsDir = join(getAgentDir(), "skills");
  mkdirSync(skillsDir, { recursive: true });

  const stats = statSync(sourcePath);
  if (stats.isFile()) {
    const fileName = basename(sourcePath);
    const skillName = safeSkillName(
      fileName.toLowerCase() === "skill.md" ? basename(dirname(sourcePath)) : basename(sourcePath, extname(sourcePath)),
    );
    const destDir = join(skillsDir, skillName);
    mkdirSync(destDir, { recursive: true });
    copyFileSync(sourcePath, join(destDir, "SKILL.md"));
    return destDir;
  }

  const skillName = safeSkillName(basename(sourcePath));
  const destDir = join(skillsDir, skillName);
  cpSync(sourcePath, destDir, { recursive: true, force: true });
  return destDir;
}

export function toNpmSource(name: string): string {
  return name.startsWith("npm:") ? name : `npm:${name}`;
}
