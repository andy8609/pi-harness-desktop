import type { PlanTask } from "./gpa";
export declare const GPA_PLAN_RELATIVE_PATH = ".codexh/gpa-plan.md";
export type GpaPlanFileStatus = "awaiting_confirmation" | "in_progress" | "completed" | "abandoned";
export interface GpaPlanFileDocument {
    status: GpaPlanFileStatus;
    threadId: string;
    updatedAt: string;
    tasks: PlanTask[];
    body: string;
}
export interface GpaPlanResumePreview {
    status: GpaPlanFileStatus;
    sourceThreadId: string;
    currentThreadId: string;
    sameSession: boolean;
    updatedAt: string;
    tasks: PlanTask[];
    body: string;
    doneCount: number;
    pendingCount: number;
    pendingTasks: PlanTask[];
}
export declare function formatGpaPlanMarkdown(input: {
    status: GpaPlanFileStatus;
    threadId: string;
    updatedAt?: string;
    tasks: PlanTask[];
    body?: string;
}): string;
export declare function parseGpaPlanMarkdown(content: string): GpaPlanFileDocument | null;
export declare function gpaPlanHasIncompleteTasks(doc: GpaPlanFileDocument | null | undefined): boolean;
export declare function toGpaPlanResumePreview(doc: GpaPlanFileDocument, currentThreadId: string): GpaPlanResumePreview;
export declare function buildGpaPlanFileResumeDirective(doc: {
    status: string;
    tasks: PlanTask[];
}): string;
