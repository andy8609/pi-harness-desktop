import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { formatGpaPlanMarkdown, GPA_PLAN_RELATIVE_PATH, parseGpaPlanMarkdown, } from "@shared/gpa-plan-file";
export function resolveGpaPlanFilePath(cwd) {
    return join(cwd, GPA_PLAN_RELATIVE_PATH);
}
export async function readGpaPlanFile(cwd) {
    try {
        const content = await readFile(resolveGpaPlanFilePath(cwd), "utf8");
        return parseGpaPlanMarkdown(content);
    }
    catch (error) {
        if (error.code === "ENOENT")
            return null;
        throw error;
    }
}
export async function writeGpaPlanFile(cwd, input) {
    const filePath = resolveGpaPlanFilePath(cwd);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, formatGpaPlanMarkdown(input), "utf8");
    return filePath;
}
