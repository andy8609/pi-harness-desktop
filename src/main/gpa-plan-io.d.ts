import { type GpaPlanFileDocument, type GpaPlanFileStatus } from "@shared/gpa-plan-file";
import type { PlanTask } from "@shared/gpa";
export declare function resolveGpaPlanFilePath(cwd: string): string;
export declare function readGpaPlanFile(cwd: string): Promise<GpaPlanFileDocument | null>;
export declare function writeGpaPlanFile(cwd: string, input: {
    status: GpaPlanFileStatus;
    threadId: string;
    updatedAt?: string;
    tasks: PlanTask[];
    body?: string;
}): Promise<string>;
