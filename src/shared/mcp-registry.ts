/**
 * 官方 MCP Registry（registry.modelcontextprotocol.io）记录 → 市场模板。
 *
 * 纯映射，不做网络。没有可运行形态（既无 npm/pypi 包、也无公网 https 远端）
 * 的记录返回 null：市场不会保存一份装不起来的模板。
 */
import {
  catalogEntryError,
  isSafeHttpsUrl,
  type McpCatalogCategory,
  type McpCatalogEntry,
  type McpCatalogRequiredEnv,
} from "./mcp-catalog";

export type RegistryEnvVar = {
  name?: string;
  description?: string;
  isRequired?: boolean;
  /** Registry 侧固定值 / 默认值：成为安装表单的预填值。 */
  value?: string;
  default?: string;
};

export type RegistryArgument = {
  type?: string;
  name?: string;
  value?: string;
};

export type RegistryPackage = {
  registryType?: string;
  identifier?: string;
  version?: string;
  runtimeHint?: string;
  runtimeArguments?: RegistryArgument[];
  packageArguments?: RegistryArgument[];
  environmentVariables?: RegistryEnvVar[];
};

export type RegistryRemote = {
  type?: string;
  url?: string;
  headers?: Array<{ name?: string; value?: string }>;
};

export type RegistryServer = {
  name?: string;
  title?: string;
  description?: string;
  homepage?: string;
  repository?: { url?: string } | string;
  packages?: RegistryPackage[];
  remotes?: RegistryRemote[];
};

export type RegistryRecord = { server?: RegistryServer };

/** 反向域名 → id 安全的 slug（`com.pulsemcp/foo` → `com-pulsemcp-foo`）。 */
export function registryIdFromName(name: string): string {
  const slug = name
    .toLowerCase()
    .split("/")
    .map((part) => part.replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, ""))
    .filter(Boolean)
    .join("-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  if (!slug) return "mcp-server";
  return /^[a-z]/.test(slug) ? slug : `mcp-${slug}`.slice(0, 64);
}

function envSpecs(pkg: RegistryPackage): McpCatalogRequiredEnv[] {
  return (pkg.environmentVariables ?? [])
    .filter((variable): variable is RegistryEnvVar & { name: string } =>
      typeof variable.name === "string" && !!variable.name,
    )
    .map((variable) => ({
      name: variable.name,
      ...(typeof variable.description === "string" && variable.description
        ? { description: variable.description }
        : {}),
      ...(variable.isRequired ? {} : { optional: true }),
      ...(typeof variable.value === "string"
        ? { defaultValue: variable.value }
        : typeof variable.default === "string"
          ? { defaultValue: variable.default }
          : {}),
    }));
}

/** `named` 参数保留名字与值，`positional` 只保留值。 */
export function argumentValues(args?: RegistryArgument[]): string[] {
  const out: string[] = [];
  for (const argument of args ?? []) {
    if (!argument || typeof argument !== "object") continue;
    const named = argument.type === "named" || (!!argument.name && argument.type !== "positional");
    if (named) {
      if (typeof argument.name === "string" && argument.name) out.push(argument.name);
      if (typeof argument.value === "string" && argument.value) out.push(argument.value);
    } else if (typeof argument.value === "string" && argument.value) {
      out.push(argument.value);
    }
  }
  return out;
}

function envTemplates(pkg: RegistryPackage): Record<string, string> | undefined {
  const names = (pkg.environmentVariables ?? [])
    .filter((variable): variable is RegistryEnvVar & { name: string } =>
      typeof variable.name === "string" && !!variable.name,
    )
    .map((variable) => variable.name);
  return names.length ? Object.fromEntries(names.map((name) => [name, `\${${name}}`])) : undefined;
}

function packageSpecifier(pkg: RegistryPackage, separator: "@" | "=="): string | undefined {
  if (typeof pkg.identifier !== "string" || !pkg.identifier.trim()) return undefined;
  const identifier = pkg.identifier.trim();
  const version = typeof pkg.version === "string" ? pkg.version.trim() : "";
  return version ? `${identifier}${separator}${version}` : identifier;
}

const REMOTE_PLACEHOLDER = /\$\{([A-Z_][A-Z0-9_]*)\}/g;

function remoteHeaderTemplates(remote: RegistryRemote): {
  headers: Record<string, string>;
  requiredEnv?: McpCatalogRequiredEnv[];
} {
  const headers = Object.fromEntries(
    (remote.headers ?? [])
      .filter(
        (header) =>
          typeof header.name === "string" && !!header.name && typeof header.value === "string",
      )
      .map((header) => [header.name!, header.value!]),
  );
  const names = new Set<string>();
  for (const value of Object.values(headers)) {
    for (const match of value.matchAll(REMOTE_PLACEHOLDER)) names.add(match[1]);
  }
  const requiredEnv = [...names].sort().map((name) => ({ name }));
  return { headers, ...(requiredEnv.length ? { requiredEnv } : {}) };
}

/**
 * Registry 没有分类字段；用关键词做一个廉价的猜测，
 * 顺序从具体到宽泛（docs 放最后，避免 "docker"/"docs" 前缀误判）。
 */
const CATEGORY_KEYWORDS: ReadonlyArray<readonly [McpCatalogCategory, string[]]> = [
  [
    "data",
    [
      "database",
      "sql",
      "postgres",
      "mysql",
      "mongo",
      "redis",
      "sqlite",
      "dataset",
      "warehouse",
      "analytics",
      "supabase",
      "snowflake",
    ],
  ],
  [
    "productivity",
    [
      "todo",
      "task",
      "calendar",
      "email",
      "mail",
      "remind",
      "schedule",
      "slack",
      "notion",
      "jira",
      "linear",
      "asana",
      "habit",
      "time",
    ],
  ],
  [
    "web",
    ["search", "scrape", "crawl", "browser", "fetch", "playwright", "puppeteer", "seo", "web", "surf"],
  ],
  [
    "devtools",
    [
      "github",
      "gitlab",
      "git ",
      "docker",
      "kubernetes",
      "k8s",
      "deploy",
      "terminal",
      "shell",
      "code",
      "repo",
      "issue",
      "build",
      "lint",
      "test",
      "ci ",
      "ide",
      "api",
      "sentry",
      "observability",
    ],
  ],
  [
    "docs",
    [
      "doc",
      "wiki",
      "knowledge",
      "context",
      "reference",
      "manual",
      "library",
      "framework",
      "changelog",
      "arxiv",
      "paper",
    ],
  ],
];

export function guessCategory(server: RegistryServer): McpCatalogCategory {
  const haystack = `${server.name ?? ""} ${server.title ?? ""} ${server.description ?? ""}`.toLowerCase();
  for (const [category, keywords] of CATEGORY_KEYWORDS) {
    if (keywords.some((keyword) => haystack.includes(keyword))) return category;
  }
  return "devtools";
}

/**
 * 把一条 Registry 记录映射成可安装模板。
 * 优先级 npm > pypi > streamable-http；oci 等无运行方式的记录丢弃。
 */
export function mapRegistryServer(record: RegistryRecord): McpCatalogEntry | null {
  const server = record?.server;
  if (!server?.name) return null;
  const id = registryIdFromName(server.name);
  const displayName = server.title?.trim() || server.name.split("/").pop() || server.name;
  const repositoryUrl =
    typeof server.repository === "string" ? server.repository : server.repository?.url;
  const homepage = server.homepage?.trim() || repositoryUrl || undefined;
  const base = {
    id,
    name: displayName,
    description: server.description?.trim() || undefined,
    homepage,
    categories: [guessCategory(server)],
  };

  const npm = server.packages?.find(
    (pkg) =>
      pkg.registryType?.toLowerCase() === "npm" &&
      typeof pkg.identifier === "string" &&
      !!pkg.identifier.trim(),
  );
  if (npm) {
    const runtimeArgs = argumentValues(npm.runtimeArguments);
    const packageArgs = argumentValues(npm.packageArguments);
    const packageName = packageSpecifier(npm, "@");
    const args = [...runtimeArgs];
    if (packageName && !args.includes(packageName) && !packageArgs.includes(packageName)) {
      args.push(packageName);
    }
    args.push(...packageArgs);
    const env = envTemplates(npm);
    const entry: McpCatalogEntry = {
      ...base,
      transport: "stdio",
      command: typeof npm.runtimeHint === "string" && npm.runtimeHint.trim() ? npm.runtimeHint.trim() : "npx",
      args,
      ...(env ? { env } : {}),
      ...(Array.isArray(npm.environmentVariables) && npm.environmentVariables.length
        ? { requiredEnv: envSpecs(npm) }
        : {}),
    };
    return catalogEntryError(entry) ? null : entry;
  }

  const pypi = server.packages?.find(
    (pkg) =>
      pkg.registryType?.toLowerCase() === "pypi" &&
      typeof pkg.identifier === "string" &&
      !!pkg.identifier.trim(),
  );
  if (pypi) {
    const runtimeArgs = argumentValues(pypi.runtimeArguments);
    const packageArgs = argumentValues(pypi.packageArguments);
    const packageName = packageSpecifier(pypi, "==");
    const args = [...runtimeArgs];
    if (packageName && !args.includes(packageName) && !packageArgs.includes(packageName)) {
      args.push(packageName);
    }
    args.push(...packageArgs);
    const env = envTemplates(pypi);
    const entry: McpCatalogEntry = {
      ...base,
      transport: "stdio",
      command: typeof pypi.runtimeHint === "string" && pypi.runtimeHint.trim() ? pypi.runtimeHint.trim() : "uvx",
      args,
      prerequisites: ["需要本机已安装 uv / uvx"],
      ...(env ? { env } : {}),
      ...(Array.isArray(pypi.environmentVariables) && pypi.environmentVariables.length
        ? { requiredEnv: envSpecs(pypi) }
        : {}),
    };
    return catalogEntryError(entry) ? null : entry;
  }

  const remote = server.remotes?.find(
    (candidate) =>
      candidate?.type?.toLowerCase() === "streamable-http" &&
      isSafeHttpsUrl(candidate.url ?? ""),
  );
  if (remote) {
    const template = remoteHeaderTemplates(remote);
    const entry: McpCatalogEntry = {
      ...base,
      transport: "http",
      url: remote.url!,
      ...(Object.keys(template.headers).length ? { headers: template.headers } : {}),
      ...(template.requiredEnv ? { requiredEnv: template.requiredEnv } : {}),
    };
    return catalogEntryError(entry) ? null : entry;
  }

  return null;
}

/** 内置条目优先，Registry 条目按 id 去重后追加。 */
export function mergeRegistryEntries(
  builtin: McpCatalogEntry[],
  remote: McpCatalogEntry[],
): McpCatalogEntry[] {
  const seen = new Set(builtin.map((entry) => entry.id));
  const merged = [...builtin];
  for (const entry of remote) {
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    merged.push(entry);
  }
  return merged;
}
