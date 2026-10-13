import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
function stripJsonc(text) {
    return text
        .replace(/^\uFEFF/, "")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|[^:])\/\/.*$/gm, "$1")
        .replace(/,\s*([}\]])/g, "$1");
}
export function readModelsFile(path) {
    if (!existsSync(path)) {
        return { file: { providers: {} }, raw: "{\n  \"providers\": {}\n}\n" };
    }
    const raw = readFileSync(path, "utf8");
    try {
        const file = JSON.parse(stripJsonc(raw));
        return { file, raw };
    }
    catch (error) {
        return {
            file: { providers: {} },
            raw,
            error: error instanceof Error ? error.message : String(error),
        };
    }
}
export function writeModelsFile(path, file) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`, "utf8");
}
