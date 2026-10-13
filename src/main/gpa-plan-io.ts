import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  formatGpaPlanMarkdown,
  GPA_PLAN_RELATIVE_PATH,
  parseGpaPlanMarkdown,
  type GpaPlanFileDocument,
  type GpaPlanFileStatus,
} from "@shared/gpa-plan-file";
import type { PlanTask } from "@shared/gpa";

export function resolveGpaPlanFilePath(cwd: string): string {
  return join(cwd, GPA_PLAN_RELATIVE_PATH);
}

export async function readGpaPlanFile(cwd: string): Promise<GpaPlanFileDocument | null> {
  try {
    const content = await readFile(resolveGpaPlanFilePath(cwd), "utf8");
    return parseGpaPlanMarkdown(content);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function writeGpaPlanFile(
  cwd: string,
  input: {
    status: GpaPlanFileStatus;
    threadId: string;
    updatedAt?: string;
    tasks: PlanTask[];
    body?: string;
  },
): Promise<string> {
  const filePath = resolveGpaPlanFilePath(cwd);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, formatGpaPlanMarkdown(input), "utf8");
  return filePath;
}
