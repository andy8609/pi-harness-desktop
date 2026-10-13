/**
 * GPA (Goal / Plan / Act) workflow — pure state machine and parsers.
 *
 * Ported from workagent's `packages/agent-runtime/src/gpa.ts`. The runtime
 * specifics (tool enforcement, system-prompt injection) live in the built-in
 * pi extension; everything here is deterministic and side-effect free so it can
 * be shared by the main process and the renderer.
 */
export type GpaStage = "off" | "goal" | "plan" | "act";
export interface PlanTask {
    id: string;
    title: string;
    done: boolean;
}
export interface GpaState {
    stage: GpaStage;
    planTasks: PlanTask[];
    /** Set when a stage is waiting for the user's confirmation. */
    awaitingConfirmation: "goal" | "plan" | null;
    updatedAt: string;
}
export declare const DEFAULT_GPA_STATE: GpaState;
export declare function createDefaultGpaState(): GpaState;
export declare function gpaStageLabel(stage: GpaStage): string;
/** GOAL / PLAN are analysis-only phases; tools are disabled there. */
export declare function gpaStageAllowsTools(state: GpaState): boolean;
export declare function canEnterGpaAct(state: GpaState): boolean;
export declare function nextStageAfterConfirmation(stage: GpaStage): GpaStage;
export declare function detectGpaConfirmation(text: string): boolean;
export declare function buildGpaSystemDirective(state: GpaState): string;
/** Strict parser for the canonical `### T1: title` plan format. */
export declare function parseCanonicalGpaPlanTasks(content: string): PlanTask[];
/** Lenient parser covering headings, list items, numbered and Chinese plans. */
export declare function parseGpaPlanTasks(content: string): PlanTask[];
/** Keep completed state when a later PLAN output contains more tasks. */
export declare function reconcileGpaPlanTasks(current: PlanTask[], planBody: string): PlanTask[];
/**
 * Live PLAN parse: replace the task list as headings stream in, refining titles
 * and growing the list, while preserving any already-completed IDs.
 */
export declare function liveReconcileGpaPlanTasks(current: PlanTask[], planBody: string): PlanTask[];
export declare function normalizeSequentialPlanTasks(tasks: PlanTask[]): PlanTask[];
export interface GpaCompletedTaskDeclaration {
    taskIds: string[];
    text: string;
}
/**
 * Find explicit ACT progress statements such as `✅ 任务 T1 完成` or `T1 completed`.
 * Future-tense prose ("开始实现 T1") is intentionally ignored.
 */
export declare function parseGpaCompletedTaskDeclarations(content: string, planTasks: PlanTask[]): GpaCompletedTaskDeclaration[];
/** Checkbox-style ACT progress such as `- [x] **T1** title`. */
export declare function parseGpaCheckboxCompletions(content: string, planTasks: PlanTask[]): string[];
export declare function isInternalGpaPrompt(text: string): boolean;
export declare function displayGpaPrompt(text: string): string | undefined;
export declare function buildGpaContinuePrompt(input: {
    nextTask: PlanTask;
    doneCount: number;
    totalCount: number;
}): string;
export declare function buildGpaResumePrompt(pendingCount: number): string;
/** Advance only the earliest unfinished task, never skipping prerequisites. */
export declare function applyCompletedPlanTasks(state: GpaState, completedTaskIds: string[]): GpaState;
