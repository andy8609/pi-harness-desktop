/**
 * Node 测试用解析钩子：让 TS 源码可以直接被 `node --test` 加载。
 *
 * 1. `@shared/*` → `src/shared/*.ts`（对齐 tsconfig paths）
 * 2. 无扩展名的相对导入 → 依次尝试 `.ts` / `.tsx` / `index.ts`（对齐 bundler 解析）
 *
 * 生产构建不走这里（electron-vite 自己解析）；仅测试进程使用。
 */
import { existsSync } from "node:fs";
import { dirname, extname, resolve as resolvePath } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = process.cwd();

export function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@shared/")) {
    const target = resolvePath(root, "src", "shared", `${specifier.slice("@shared/".length)}.ts`);
    return nextResolve(pathToFileURL(target).href, context);
  }

  const relative = specifier.startsWith("./") || specifier.startsWith("../");
  if (relative && !extname(specifier) && context.parentURL) {
    const base = resolvePath(dirname(fileURLToPath(context.parentURL)), specifier);
    for (const candidate of [`${base}.ts`, `${base}.tsx`, resolvePath(base, "index.ts")]) {
      if (existsSync(candidate)) return nextResolve(pathToFileURL(candidate).href, context);
    }
  }

  return nextResolve(specifier, context);
}
