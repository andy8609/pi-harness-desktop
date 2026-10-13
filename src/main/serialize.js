import { sessionEntryToContextMessages } from "@earendil-works/pi-coding-agent";
import { displayGpaPrompt, isInternalGpaPrompt } from "@shared/gpa";
function asThinkingLevel(value) {
    const allowed = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
    return allowed.includes(value) ? value : "off";
}
function cloneJson(value) {
    try {
        return JSON.parse(JSON.stringify(value));
    }
    catch {
        return value;
    }
}
function rewriteInternalGpaContent(role, content) {
    if (role !== "user")
        return content;
    const text = contentPlainText(content);
    if (!isInternalGpaPrompt(text))
        return content;
    return displayGpaPrompt(text) ?? "继续执行剩余的 GPA 计划任务";
}
export function serializeMessage(message) {
    const msg = cloneJson((message ?? {}));
    const role = String(msg.role ?? "unknown");
    let content = msg.content;
    if ((role === "compactionSummary" || role === "branchSummary") && (content == null || content === "")) {
        content = String(msg.summary ?? "");
    }
    content = rewriteInternalGpaContent(role, content);
    return {
        role,
        content,
        timestamp: msg.timestamp ?? undefined,
        customType: typeof msg.customType === "string" ? msg.customType : undefined,
        toolCallId: typeof msg.toolCallId === "string" ? msg.toolCallId : undefined,
        toolName: typeof msg.toolName === "string" ? msg.toolName : undefined,
        isError: Boolean(msg.isError),
        details: msg.details,
        usage: msg.usage,
        stopReason: typeof msg.stopReason === "string" ? msg.stopReason : undefined,
        errorMessage: typeof msg.errorMessage === "string" ? msg.errorMessage : undefined,
        command: typeof msg.command === "string" ? msg.command : undefined,
        output: typeof msg.output === "string" ? msg.output : undefined,
        exitCode: typeof msg.exitCode === "number" ? msg.exitCode : undefined,
        cancelled: Boolean(msg.cancelled),
    };
}
function contentPlainText(content) {
    if (typeof content === "string")
        return content;
    if (!Array.isArray(content))
        return "";
    return content
        .map((part) => (part.type === "text" ? String(part.text ?? "") : ""))
        .join("")
        .replace(/\s+/g, " ")
        .trim();
}
export function collectDisplayMessages(session) {
    const persisted = session.sessionManager.getBranch().flatMap((entry) => sessionEntryToContextMessages(entry)
        .filter((message) => {
        const item = message;
        return item.role !== "custom" || item.display === true;
    })
        .map((message) => ({ ...serializeMessage(message), entryId: entry.id })));
    const live = session.messages
        .filter((message) => {
        const item = message;
        return item.role !== "custom" || item.display === true;
    })
        .map(serializeMessage);
    if (persisted.length === 0)
        return live;
    return mergeStreamingTail(persisted, live);
}
function lastUserIndex(messages) {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        if (messages[index].role === "user")
            return index;
    }
    return -1;
}
function mergeStreamingTail(persisted, live) {
    if (live.length === 0)
        return persisted;
    const liveUser = lastUserIndex(live);
    const persistedUser = lastUserIndex(persisted);
    if (liveUser < 0 || persistedUser < 0) {
        const lastPersisted = persisted[persisted.length - 1];
        const lastLive = live[live.length - 1];
        if (lastPersisted && lastLive && lastPersisted.role === lastLive.role && lastLive.role === "assistant") {
            return [...persisted.slice(0, -1), lastLive];
        }
        return persisted;
    }
    const liveText = contentPlainText(live[liveUser].content);
    const persistedText = contentPlainText(persisted[persistedUser].content);
    if (liveText && liveText === persistedText) {
        return [...persisted.slice(0, persistedUser), ...live.slice(liveUser)];
    }
    return persisted;
}
export function firstUserPreview(messages) {
    const user = messages.find((message) => message.role === "user");
    if (!user)
        return undefined;
    const text = contentPlainText(user.content);
    return text ? text.slice(0, 40) : undefined;
}
function summarizeEntry(entry) {
    if (entry.type === "message") {
        const message = entry.message;
        const role = String(message?.role ?? "message");
        const content = message?.content;
        let text = "";
        if (typeof content === "string")
            text = content;
        else if (Array.isArray(content)) {
            text = content
                .map((part) => {
                const item = part;
                if (item.type === "text")
                    return String(item.text ?? "");
                if (item.type === "toolCall" || item.type === "tool_call")
                    return `[tool ${String(item.name ?? "")}]`;
                if (item.type === "thinking")
                    return "[thinking]";
                return "";
            })
                .join(" ");
        }
        return `${role}: ${text.replace(/\s+/g, " ").slice(0, 80)}`;
    }
    if (entry.type === "compaction")
        return `compaction: ${String(entry.summary ?? "").slice(0, 80)}`;
    if (entry.type === "model_change")
        return `model ${String(entry.provider)}/${String(entry.modelId)}`;
    if (entry.type === "thinking_level_change")
        return `thinking ${String(entry.thinkingLevel)}`;
    if (entry.type === "session_info")
        return `name ${String(entry.name ?? "")}`;
    if (entry.type === "custom")
        return `custom ${String(entry.customType ?? "")}`.trim();
    return String(entry.type ?? "entry");
}
export function serializeTree(nodes) {
    return (nodes ?? []).map((node) => {
        const item = node;
        const entry = item.entry ?? {};
        return {
            id: String(entry.id ?? ""),
            type: String(entry.type ?? "unknown"),
            timestamp: typeof entry.timestamp === "string" ? entry.timestamp : undefined,
            label: item.label,
            summary: summarizeEntry(entry),
            children: serializeTree(item.children ?? []),
        };
    });
}
export function collectUsage(messages) {
    const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
    for (const message of messages) {
        if (!message.usage)
            continue;
        usage.input += message.usage.input ?? 0;
        usage.output += message.usage.output ?? 0;
        usage.cacheRead += message.usage.cacheRead ?? 0;
        usage.cacheWrite += message.usage.cacheWrite ?? 0;
        usage.cost += message.usage.cost?.total ?? 0;
    }
    return usage;
}
export function buildSnapshot(input) {
    const messages = input.messages;
    const usage = collectUsage(messages);
    if (input.contextUsage) {
        usage.contextTokens = input.contextUsage.tokens;
        usage.contextWindow = input.contextUsage.contextWindow;
        usage.contextPercent = input.contextUsage.percent;
    }
    return {
        cwd: input.cwd,
        sessionId: input.sessionId,
        sessionName: input.sessionName,
        displayName: input.sessionName || firstUserPreview(messages),
        sessionFile: input.sessionFile,
        messages,
        isStreaming: input.isStreaming,
        isCompacting: input.isCompacting,
        model: input.model?.id
            ? {
                provider: String(input.model.provider ?? ""),
                id: String(input.model.id),
                name: input.model.name,
                contextWindow: input.model.contextWindow,
                maxTokens: input.model.maxTokens,
                reasoning: input.model.reasoning,
            }
            : undefined,
        thinkingLevel: asThinkingLevel(input.thinkingLevel),
        availableThinkingLevels: input.availableThinkingLevels && input.availableThinkingLevels.length > 0
            ? input.availableThinkingLevels
            : ["off"],
        usage,
        queue: input.queue ?? { steering: [], followUp: [] },
        resources: input.resources,
        diagnostics: input.diagnostics,
        modelFallbackMessage: input.modelFallbackMessage,
        projectTrusted: input.projectTrusted,
        gpa: input.gpa,
        gpaPlanResume: input.gpaPlanResume ?? null,
    };
}
