export const GPA_PLAN_RELATIVE_PATH = ".codexh/gpa-plan.md";
export function formatGpaPlanMarkdown(input) {
    const updatedAt = input.updatedAt ?? new Date().toISOString();
    const taskLines = input.tasks.map((task) => {
        const mark = task.done ? "x" : " ";
        return `- [${mark}] **${task.id}** ${task.title}`;
    });
    const body = (input.body ?? "").trim();
    return [
        "# GPA Plan",
        "",
        `- **status**: \`${input.status}\``,
        `- **thread_id**: \`${input.threadId}\``,
        `- **updated_at**: \`${updatedAt}\``,
        "",
        "## Tasks",
        "",
        ...(taskLines.length > 0 ? taskLines : ["- [ ] **T1** （空计划）"]),
        "",
        "## Plan Body",
        "",
        body || "_（无正文）_",
        "",
    ].join("\n");
}
export function parseGpaPlanMarkdown(content) {
    const text = content.trim();
    if (!text)
        return null;
    const statusMatch = text.match(/\*\*status\*\*:\s*`([^`]+)`/i);
    const threadMatch = text.match(/\*\*thread_id\*\*:\s*`([^`]+)`/i);
    const updatedMatch = text.match(/\*\*updated_at\*\*:\s*`([^`]+)`/i);
    const statusRaw = statusMatch?.[1]?.trim() ?? "in_progress";
    const status = statusRaw === "completed" ||
        statusRaw === "awaiting_confirmation" ||
        statusRaw === "in_progress" ||
        statusRaw === "abandoned"
        ? statusRaw
        : "in_progress";
    const tasks = [];
    const taskSection = text.split(/##\s*Tasks\b/i)[1]?.split(/##\s*Plan Body\b/i)[0] ?? text;
    for (const line of taskSection.split(/\r?\n/)) {
        const match = line.match(/^\s*[-*+]\s*\[([ xX])\]\s*\*\*(T\d+)\*\*\s+(.+?)\s*$/i);
        if (!match)
            continue;
        tasks.push({
            id: match[2].toUpperCase(),
            title: match[3].trim(),
            done: match[1].toLowerCase() === "x",
        });
    }
    if (tasks.length === 0)
        return null;
    return {
        status,
        threadId: threadMatch?.[1]?.trim() ?? "",
        updatedAt: updatedMatch?.[1]?.trim() ?? new Date().toISOString(),
        tasks,
        body: (text.split(/##\s*Plan Body\b/i)[1] ?? "").trim(),
    };
}
export function gpaPlanHasIncompleteTasks(doc) {
    return Boolean(doc &&
        doc.status !== "completed" &&
        doc.status !== "abandoned" &&
        (doc.status === "awaiting_confirmation" || doc.tasks.some((task) => !task.done)));
}
export function toGpaPlanResumePreview(doc, currentThreadId) {
    const pendingTasks = doc.tasks.filter((task) => !task.done);
    return {
        status: doc.status,
        sourceThreadId: doc.threadId,
        currentThreadId,
        sameSession: Boolean(doc.threadId) && doc.threadId === currentThreadId,
        updatedAt: doc.updatedAt,
        tasks: doc.tasks,
        body: doc.body,
        doneCount: doc.tasks.filter((task) => task.done).length,
        pendingCount: pendingTasks.length,
        pendingTasks,
    };
}
export function buildGpaPlanFileResumeDirective(doc) {
    const pending = doc.tasks.filter((task) => !task.done);
    const lines = pending.map((task) => `- ${task.id}: ${task.title}`);
    return [
        `\nExisting project plan file: ${GPA_PLAN_RELATIVE_PATH} (status=${doc.status}).`,
        "Continue from this plan. Do not restart GOAL/PLAN analysis or recreate tasks already listed.",
        "Focus on incomplete tasks:",
        ...lines,
        "After finishing a task, output `✅ 任务 {ID} 完成` and immediately continue the next unfinished task. Do not wait for the user to type 继续.",
    ].join("\n");
}
