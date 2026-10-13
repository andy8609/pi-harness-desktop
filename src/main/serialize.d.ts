import { type SessionEntry } from "@earendil-works/pi-coding-agent";
import type { GpaState } from "@shared/gpa";
import type { GpaPlanResumePreview } from "@shared/gpa-plan-file";
import type { ChatMessage, ResourceSummary, SessionSnapshot, SessionUsage, ThinkingLevel, TreeNode } from "@shared/types";
export declare function serializeMessage(message: unknown): ChatMessage;
export declare function collectDisplayMessages(session: {
    messages: unknown[];
    sessionManager: {
        getBranch: () => SessionEntry[];
    };
}): ChatMessage[];
export declare function firstUserPreview(messages: ChatMessage[]): string | undefined;
export declare function serializeTree(nodes: unknown[]): TreeNode[];
export declare function collectUsage(messages: ChatMessage[]): SessionUsage;
export declare function buildSnapshot(input: {
    cwd: string;
    sessionId: string;
    sessionName?: string;
    sessionFile?: string;
    messages: ChatMessage[];
    isStreaming: boolean;
    isCompacting: boolean;
    model?: {
        provider?: string;
        id?: string;
        name?: string;
        contextWindow?: number;
        maxTokens?: number;
        reasoning?: boolean;
    };
    thinkingLevel: unknown;
    availableThinkingLevels?: ThinkingLevel[];
    resources: ResourceSummary;
    diagnostics: Array<{
        type: string;
        message: string;
    }>;
    modelFallbackMessage?: string;
    projectTrusted: boolean;
    queue?: {
        steering: string[];
        followUp: string[];
    };
    contextUsage?: {
        tokens?: number | null;
        contextWindow?: number;
        percent?: number | null;
    };
    gpa?: GpaState;
    gpaPlanResume?: GpaPlanResumePreview | null;
}): SessionSnapshot;
